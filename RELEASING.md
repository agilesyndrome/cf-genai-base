# Releasing

Run `npm run build` before starting a release. It performs strict TypeScript
checking for migrated modules, compiles the hybrid source tree to `dist/`,
runs the source tests, verifies compiled package exports, and checks the npm
tarball. The `prepack` lifecycle rebuilds `dist/` again before publication so
source files are never published as runtime entrypoints.

Run `npx --yes @agilesyndrome/cf-genai-base release --confirm` from this directory.
It validates a clean tree, bumps the patch version if needed, commits package
metadata, creates `v<version>`, and pushes the branch and tag. The tag starts
the GitHub Actions workflow.

For a reusable prerelease build, run `cf-genai release --pre --confirm`. It
uses `<currentVersion>-pre` when that version exists on npm, or bumps the patch
once and creates `<bumpedVersion>-pre`; subsequent prerelease runs reuse the
same version and tag.

For the one-time npm bootstrap, run
`node bin/cf-genai.js release --first --confirm`. It performs the initial
publish and configures npm Trusted Publishing for organization `agilesyndrome`,
this repository, and workflow `publish.yml`. Later releases use GitHub OIDC and
require no npm token.
