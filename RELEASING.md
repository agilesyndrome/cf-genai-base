# Releasing

## One-time bootstrap

The package must exist on npm before npm allows a Trusted Publisher to be
configured. From this directory, run an interactive first publish:

```sh
npm publish --access public --provenance
```

Complete npm's account/2FA prompt. This publishes the version currently declared in `package.json`.

## GitHub Actions releases

After the bootstrap publish, configure npm Trusted Publishing for this package:

- Provider: GitHub Actions
- Organization/user: `agilesyndrome`
- Repository: `cf-genai-base`
- Workflow filename: `publish.yml`
- Environment: blank
- Allowed action: `npm publish`

For later releases, bump `version` in `package.json`, commit and push it to
`main`, then create and push a matching `v*` tag. The workflow runs package
verification and publishes using GitHub OIDC; no npm token secret is required.
