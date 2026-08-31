# Contributing

This is a small library maintained in spare time. Issues and pull requests are
welcome, and there is no process beyond the obvious.

## Raising an issue

[Open an issue](https://github.com/heron--/field-search/issues). For a bug, the
query string that triggers it is usually the whole report.

## Opening a pull request

Fork, branch, and open a PR against `main`. Before you do:

```sh
npm install
npm test
npm run typecheck
npm run visual:check
npx prettier --write .
```

CI runs the same commands, so a green local run should stay green.

If you change the React components, read [docs/testing.md](docs/testing.md)
first. It explains which of the two test tiers a given change belongs in, and
why some behaviour can only be checked in a real browser.

## Licence

Contributions are accepted under the [MIT licence](LICENSE).
