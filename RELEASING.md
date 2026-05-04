# Releasing Kanbun

Kanbun follows [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH) and [Conventional Commits](https://www.conventionalcommits.org/).

## TL;DR

```bash
# 1. Make sure main is green and you're on it
git checkout main && git pull

# 2. Bump version
npm version <patch|minor|major> --no-git-tag-version

# 3. Update CHANGELOG.md (move Unreleased -> new version, add date)
$EDITOR CHANGELOG.md

# 4. Update src/lib/changelog.ts with the same entry (so /whats-new shows it in-app)
$EDITOR src/lib/changelog.ts

# 5. Commit + tag + push
git add package.json package-lock.json CHANGELOG.md src/lib/changelog.ts
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main vX.Y.Z
```

The `Release` workflow takes over once the tag is pushed. It builds a multi-arch Docker image (amd64 + arm64), pushes it to `ghcr.io/<owner>/kanbun:vX.Y.Z` (also `:X.Y`, `:X`, and `:latest`), and creates a GitHub release with auto-generated notes from PRs since the last tag.

## Versioning rules

- **PATCH** (`v0.1.0` -> `v0.1.1`): bug fixes, security patches, doc-only changes that affect users.
- **MINOR** (`v0.1.0` -> `v0.2.0`): backwards-compatible features. New columns/cards/UI capabilities, new optional config.
- **MAJOR** (`v0.x.y` -> `v1.0.0`): breaking schema migrations that need manual intervention, removed config flags, changed cookie names, changed AGPL terms.

While we are pre-1.0, treat MINOR as potentially breaking and call it out in `CHANGELOG.md` under a `### Breaking` heading.

## Database migrations

Migrations are part of the release. The Docker `CMD` runs `prisma migrate deploy` on every start, so users get the new schema automatically. **Never** include irreversible destructive migrations in a PATCH release. If a column drop is needed, MINOR at minimum, with a clear note in the changelog telling users to back up `kanbun.db` first.

## Pre-releases

For RC builds, tag with a hyphen suffix:

```bash
git tag -a v0.2.0-rc.1 -m "v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

The release workflow detects the suffix and:

- Marks the GitHub release as `prerelease`.
- Skips the `:latest` Docker tag (only `:0.2.0-rc.1` is published).

## Hotfix process

```bash
git checkout -b hotfix/v0.1.1 v0.1.0
# fix
git commit -am "fix: <thing>"
git push origin hotfix/v0.1.1
# open PR, merge, then from main:
git checkout main && git pull
npm version patch --no-git-tag-version
# update changelogs, commit, tag, push as TL;DR above
```

## What CI does on every PR

- `npm ci`
- `prisma generate`
- `tsc --noEmit`
- `next build` against a throwaway SQLite database

Failing PRs are blocked from merging once you turn on branch protection in repo settings.

## What the release workflow does on every `v*.*.*` tag

1. Builds Docker image for `linux/amd64` + `linux/arm64`.
2. Pushes to `ghcr.io/<owner>/kanbun` with tags: `vX.Y.Z`, `X.Y`, `X`, and `latest` (only stable, not pre-releases).
3. Attaches build provenance and SBOM to the image.
4. Creates a GitHub release. Notes are auto-generated from merged PRs since the last tag, categorized via `.github/release.yml` (PR labels: `feat`, `fix`, `breaking-change`, etc.).

## Changelog discipline

Every user-visible change should land in `CHANGELOG.md` (machine-readable history) **and** `src/lib/changelog.ts` (in-app `/whats-new` page). The two files share the same entries, but the in-app version is bilingual EN/PL.

For PR titles, use Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, etc.) so the categorization in `release.yml` works without label churn. Add labels (`feat`, `fix`, `breaking-change`) where the prefix alone is ambiguous.
