import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

/** Web-only option; native ignores this. */
export type ShareDealRecapPdfOptions = {
  targetWindow?: unknown
}

/**
 * iOS / Android: render HTML to a temp PDF, then system share sheet (or print fallback).
 */
export async function shareDealRecapPdfFromHtml(
  html: string,
  dialogTitle: string,
  _options?: ShareDealRecapPdfOptions
): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html })
  const available = await Sharing.isAvailableAsync()
  if (!available) {
    await Print.printAsync({ uri })
    return
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle,
  })
}
