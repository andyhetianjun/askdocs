# Logging guide

Created: March 2, 2026

## Levels

Use DEBUG for details that only matter while developing, INFO for normal events such as a request finishing, WARNING for things that look wrong but are handled, and ERROR when an operation failed. Do not log passwords or tokens at any level.

## Format

Every log line carries a timestamp, the level and the logger name. Create one logger per module with logging.getLogger(__name__) so the name shows where a message came from.
