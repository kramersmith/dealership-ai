/**
 * PNG export uses html2canvas on web only. Native builds use PDF for the same controls.
 */
export async function shareDealRecapPngFromHtml(_html: string, _baseFilename: string): Promise<void> {
  throw new Error('PNG export is only available in the browser. Use PDF on this device.')
}
