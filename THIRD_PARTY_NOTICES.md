# Third-Party Notices

## Mozilla Readability

`lib/sentence/content_parser.ts` contains an adaptation of the `_grabArticle` and `_getClassWeight` algorithms from [Mozilla Readability][readability].

Copyright (c) 2010 Arc90 Inc.

Copyright (c) 2010-2026 Mozilla and Contributors

Licensed under the Apache License, Version 2.0. The full license text must be distributed with releases that include this adaptation.

The adaptation is modified to select an existing live-DOM root for sentence wrapping. It does not include or render Readability's extracted article DOM.

[readability]: https://github.com/mozilla/readability
