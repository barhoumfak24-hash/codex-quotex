# Quotex Connect mock carrier

This static portal provides deterministic, synthetic pages for extension development. It never connects to a real insurer.

Serve this directory with a local HTTPS server. Supported states are `login`, `mfa`, `quote`, `expired`, `maintenance`, `rate-limit`, `captcha`, `ambiguous`, `error`, and `changed-layout`, selected with the `state` query parameter.

The successful quote selectors are:

- Ready: `#quote-ready`
- Annual premium: `#annual-premium`
- Carrier reference: `#quote-reference`
- Effective date: `#effective-date`
- Status: `#quote-status`

`changed-layout` deliberately removes the ready selector so the runner must stop without producing a verified result.
