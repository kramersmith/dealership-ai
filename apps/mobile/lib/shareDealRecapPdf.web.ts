export type ShareDealRecapPdfOptions = {
  /**
   * Window opened synchronously from the user click (before any `await`).
   * Required when the caller fetches HTML asynchronously — otherwise the browser
   * may block `window.open` or return no usable `Window` reference.
   */
  targetWindow?: Window | null
}

function writeHtmlAndPrint(w: Window, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      w.document.open()
      w.document.write(html)
      w.document.close()
    } catch (e) {
      try {
        w.close()
      } catch {
        /* noop */
      }
      reject(e instanceof Error ? e : new Error('Could not write print document.'))
      return
    }
    const runPrint = () => {
      try {
        w.focus()
        w.print()
      } finally {
        setTimeout(() => {
          try {
            w.close()
          } catch {
            /* noop */
          }
        }, 500)
      }
      resolve()
    }
    setTimeout(runPrint, 200)
  })
}

/**
 * Web: print dialog (Save as PDF). Do not use `noopener` on `open()` — the handle is
 * often `null` while a blank tab still opens, so we cannot `document.write`.
 */
export async function shareDealRecapPdfFromHtml(
  html: string,
  _dialogTitle: string,
  options?: ShareDealRecapPdfOptions
): Promise<void> {
  const w =
    options?.targetWindow ??
    (typeof globalThis !== 'undefined' ? globalThis.open?.('about:blank', '_blank') : null)
  if (w == null) {
    throw new Error('Could not open print window. Allow pop-ups to save as PDF.')
  }
  if (options?.targetWindow == null) {
    try {
      w.opener = null
    } catch {
      /* noop */
    }
  }
  await writeHtmlAndPrint(w, html)
}
