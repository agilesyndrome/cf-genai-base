# Releasing

1. Bump `version` in `package.json`.
2. Commit the change and push it to `main`.
3. Create and push a matching tag, for example `v0.1.1`.

The `Publish package` workflow runs the package verification and publishes `@agilesyndrome/cf-genai-base` using the repository `NPM_TOKEN` secret.
