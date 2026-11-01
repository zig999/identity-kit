#!/bin/sh
# Uso: pnpm release X.Y.Z
# Cria o commit de release (com dist compilado) e a tag vX.Y.Z. Nunca move uma tag existente.
set -eu
version="${1:?informe a versao, por exemplo 0.1.0}"
tag="v$version"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "release so a partir da main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "a arvore de trabalho tem mudancas" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && { echo "a tag $tag ja existe" >&2; exit 1; }
pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm duplication
pnpm build
git checkout --detach
npm pkg set version="$version"
git add -f dist package.json
git commit -m "release $tag"
git tag "$tag"
git checkout "$branch"
echo "tag $tag criada. Envie com: git push origin $tag"
