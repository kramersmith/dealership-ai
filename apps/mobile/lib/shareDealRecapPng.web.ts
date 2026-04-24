/**
 * Web-only: rasterize recap HTML to a single tall PNG (no print pagination).
 * Falls back to download if Web Share API does not accept files.
 */
export async function shareDealRecapPngFromHtml(html: string, baseFilename: string): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    'position:absolute;left:-10000px;top:0;width:820px;height:120px;border:0;visibility:hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (doc == null) {
    iframe.remove()
    throw new Error('Could not prepare image export.')
  }

  doc.open()
  doc.write(html)
  doc.close()

  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    const id = window.setTimeout(finish, 900)
    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(id)
        finish()
      },
      { once: true }
    )
    if (iframe.contentDocument?.readyState === 'complete') {
      window.clearTimeout(id)
      finish()
    }
  })

  const body = doc.body
  const scrollH = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    body?.scrollHeight ?? 0,
    400
  )
  iframe.style.height = `${scrollH + 48}px`

  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  await new Promise<void>((r) => window.setTimeout(r, 150))

  let canvas: HTMLCanvasElement
  try {
    const { default: html2canvas } = await import('html2canvas')
    canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#0b0c0e',
      logging: false,
      width: body.scrollWidth,
      height: body.scrollHeight,
    })
  } catch (e) {
    iframe.remove()
    throw e instanceof Error ? e : new Error('Could not rasterize recap for PNG.')
  }

  iframe.remove()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b != null ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png')
  })

  const filename = baseFilename.endsWith('.png') ? baseFilename : `${baseFilename}.png`
  const file = new File([blob], filename, { type: 'image/png' })

  const nav = navigator
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: 'Deal recap' })
        return
      }
    } catch {
      /* fall through to download */
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
