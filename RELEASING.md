# Releasing

Run `npx --yes @agilesyndrome/cf-genai-base release --confirm` from this directory.
It validates a clean tree, bumps the patch version if needed, commits package
metadata, creates `v<version>`, and pushes the branch and tag. The tag starts
the GitHub Actions workflow.

For the one-time npm bootstrap, run
`node bin/cf-genai.js release --first --confirm`. It performs the initial
publish and configures npm Trusted Publishing for organization `agilesyndrome`,
this repository, and workflow `publish.yml`. Later releases use GitHub OIDC and
require no npm token.
