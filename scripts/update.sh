#!/bin/bash

echo "Verify gh version"
gh --version

repo="spring-projects/sts4"
release_tag=$(gh release list --repo "$repo" --json tagName --jq '.[].tagName' --limit 1)
echo "Targeting $release_tag from spring-projects/sts4"
gh release download "$release_tag" --repo "$repo" --pattern "vscode-spring-boot-*.vsix"

echo "Extracting server resource artifacts"
mkdir -p output_dir && unzip -o "*.vsix" -d output_dir
rm -rf ./jars && mv ./output_dir/extension/jars .
rm -rf ./language-server && mv ./output_dir/extension/language-server .

echo "Cleaning output artifacts"
rm -rf output_dir && rm -rf ./*.vsix
