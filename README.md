Bettle GIF Maker 

<img width="2560" height="1392" alt="Screenshot 2026-08-03 152922" src="https://github.com/user-attachments/assets/b8b2c30e-657f-488a-a6d0-a257fc78802c" />

Bettle GIF Maker — Feature List
================================

INPUT & IMPORT
- Drag-and-drop or click-to-browse file picker
- Accepts PDF, PNG, and JPG/JPEG
- A multi-page PDF becomes one job with one frame per page
- Multiple images selected/dropped together become one job (frames sorted by filename)
- Each separate drop/browse action creates a new job in the queue — supports multiple independent jobs at once
- "Add frames" per job — append more pages/images to an existing job without creating a new one
- Drag-and-drop reordering of jobs in the queue
- Drag-and-drop reordering of frames within a job (determines animation order)
- Per-frame include/exclude toggle (click a thumbnail to select/deselect it from the export)
- Default file name is auto-derived from the imported file's name (PDF page-number suffixes and
  extensions stripped), with automatic (2), (3)... suffixes if a name collides with another queued job

PER-JOB GIF SETTINGS (independent per job)
- Frame delay (0.1s-10s, via slider)
- Colour reduction: Selective (median-cut quantizer, shared 256-colour palette built across all frames)
- Dither mode: Diffusion, Atkinson, or None
- Dither strength (0-100)
- Loop count: Forever, Once, 3x, 5x, or 10x
- Output size: custom width x height in pixels (auto-filled from the source's native size, editable)
- Rename a job's output file — inline text edit, or via a button that opens the OS "Save As" dialog
  (Chromium browsers) to pick both a name and a save location

PROCESSING
- "Make GIF" / "Make N GIFs" — processes every queued job sequentially into a GIF
- "Make Selected GIF" — processes only the currently selected job
- Per-job progress and status (Pending / Processing / Done / Error), shown live on the job block,
  queue row, and preview tile
- Jobs with zero frames selected are skipped with an error rather than blocking the whole batch
- Parallel worker-pool dithering within each job (scales to available CPU cores), while jobs
  themselves process one at a time
- Status bar shows live progress messages and the total elapsed time once a run finishes
  (e.g. "Queue complete — 4.2s")

OUTPUT & SAVING
- Live preview grid — one tile per job, showing the rendered GIF once done
- Each tile shows the file size once complete
- Per-job "Download GIF" button (in the queue row and on its preview tile)
- "Download All" — downloads every completed job in one click
- If a save location was chosen via the rename dialog, downloads write straight to that location;
  otherwise falls back to a normal browser download
- Selecting a job (via its colour swatch, its queue row, or its preview tile) syncs that selection
  across the whole UI

INTERFACE
- Three-panel layout: job queue + frame grids (left), settings (middle), preview (right)
- Viewport-fitted layout — each panel scrolls independently instead of the whole page scrolling
- Clear/remove controls: remove a single job, or clear the entire queue
- Dark themed UI throughout
