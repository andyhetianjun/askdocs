# Release checklist

## Before tagging

Run the whole test suite and the linter. Check that the changelog lists every user visible change since the last tag. Bump the version in one place only, so the package metadata and the docs never disagree.

## After tagging

Build the wheel from a clean checkout, install it in a fresh virtual environment and run the smoke test against the installed copy. Only then upload it.
