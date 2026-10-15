# Source artwork

The original GIFs that were handed to the project. They are **not** served:
`scripts/gifs.py` reads them and writes animated WebP into `public/art/pika/`,
which is what the site actually loads. Keeping the originals here means the
pipeline can be re-run, without shipping 3.2 MB of GIF to every visitor.

| source gif | becomes | used for |
|---|---|---|
| `44-pikachu-pixel` | `run.webp` | the `competitive` mascot — Pikachu bounding along |
| `60-pikachu`       | `shy.webp` | `idle`, `defeated`, `sleeping` — the home hero |
| `61-pikachu-game`  | `hello.webp` | `excited`, `victory` |
| `70-pikachu-pixel` | `cap.webp` | `thinking`, `waiting`, `error` (the finished frames, 53+) |
| `70-pikachu-pixel` | `materialise.webp` | `loading` — the whole 59-frame sketch→ink→colour arc, every 3rd frame |
| `74-pikachu-christmas` | `gift.webp` | framed scene on Challenges |
| `75-pikachu`       | `crowd.webp` | framed scene on Play Together |
| `78-pikachu`       | `curious.webp` | framed scene on Solo Adventures |

All seven are used. The five cut-outs had their backgrounds knocked out and
float freely; the three scenes keep their original painted backdrop and are
shown matted and warm-graded through `<PikaScene/>`, because a reliable
knockout of a full anime background is not possible and a bad one looks worse
than an honest frame.
