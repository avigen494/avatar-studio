"""Cloudflare R2 storage through the S3-compatible API (boto3)."""
from __future__ import annotations

from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.adapters.storage.base import PresignedUpload, Storage
from app.config import settings
from app.services.runtime_config import cfg


class R2Storage(Storage):
    def __init__(self):
        endpoint = settings.r2_endpoint_url or f"https://{cfg('r2_account_id')}.r2.cloudflarestorage.com"
        self.bucket = cfg("r2_bucket") or settings.r2_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=cfg("r2_access_key_id"),
            aws_secret_access_key=cfg("r2_secret_access_key"),
            region_name="auto",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def ensure_cors(self) -> list[str]:
        """
        Browsers upload straight to the bucket with presigned PUTs, which R2 refuses
        until the bucket's CORS rule names the web app's origin. Called by the
        Connections test so a freshly connected bucket works without manual setup.
        """
        origins = sorted({settings.web_base_url.rstrip("/"), *settings.cors_origin_list})
        self.client.put_bucket_cors(
            Bucket=self.bucket,
            CORSConfiguration={"CORSRules": [{
                "AllowedOrigins": origins,
                "AllowedMethods": ["GET", "PUT", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }]},
        )
        return origins

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs=extra)

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        kwargs = {"Bucket": self.bucket, "Key": key, "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)

    def get_to_file(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(path))
        return path

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    def size(self, key: str) -> int:
        return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> int:
        count = 0
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})
                count += len(objs)
        return count

    def download_url(self, key: str, expires_in: int = 3600, filename: str | None = None) -> str:
        params = {"Bucket": self.bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires_in)

    def presign_upload(self, key: str, content_type: str, expires_in: int = 900) -> PresignedUpload:
        url = self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type}, ExpiresIn=expires_in
        )
        return PresignedUpload(method="PUT", url=url, headers={"Content-Type": content_type}, key=key)
