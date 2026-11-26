# Python style notes

## Reading files

We read text files with pathlib. Use Path.read_text with an explicit encoding, because the default encoding depends on the machine. For large files iterate over the file object line by line instead of reading everything into memory.

## Time and dates

Store timestamps in UTC and convert only when showing them to a person. Use datetime.now with timezone.utc, never naive datetimes, and subtract two datetimes to get a timedelta when you need a duration.

```python
from datetime import datetime, timezone
started = datetime.now(timezone.utc)
```
