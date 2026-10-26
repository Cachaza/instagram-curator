#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
revision="$(git -C "$project_dir" rev-parse --verify "${1:-HEAD}^{commit}")"
# A public image may contain no private library data or personal visual captures.
private_paths="$(git -C "$project_dir" ls-tree -r --name-only "$revision" | awk '
  /^data\// || /^docs\/(screenshots|design)\// ||
  /^\.env($|\.)/ && $0 != ".env.example" ||
  /(^|\/)(curator\.sqlite|auth-secret|instagram-session|cookies\.txt)$/ { print }
')"
if [ -n "$private_paths" ]; then
  echo "Refusing public image publication: tracked private-data paths found:" >&2
  echo "$private_paths" >&2
  echo "Move these files into private storage and remove them from the committed revision before publishing." >&2
  exit 1
fi
image="${CURATOR_IMAGE:-ghcr.io/cachaza/instagram-curator}"
# The production Dokploy host is AMD64; Docker Desktop on the ARM Mac emulates it.
platform="${CURATOR_IMAGE_PLATFORM:-linux/amd64}"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
metadata_dir="$project_dir/data/runtime/image-publish"
mkdir -p "$metadata_dir"
metadata_file="$metadata_dir/$revision.json"

# Export committed files only. Local data, credentials and uncommitted edits
# cannot enter the build context, even if the working directory contains them.
git -C "$project_dir" archive "$revision" | tar -x -C "$build_dir"
echo "Building committed revision $revision for $platform on the selected local Docker builder."
docker buildx build \
  --platform "$platform" \
  --tag "$image:sha-$revision" \
  --label "org.opencontainers.image.revision=$revision" \
  --label "org.opencontainers.image.source=https://github.com/Cachaza/instagram-curator" \
  --metadata-file "$metadata_file" \
  --push \
  "$build_dir"

python3 - "$metadata_file" "$image" <<'PY'
import json,sys
with open(sys.argv[1]) as source:
    digest=json.load(source)['containerimage.digest']
print(f'Published image: {sys.argv[2]}@{digest}')
print('Use this digest in Dokploy; the SHA tag is also available for reference.')
PY
