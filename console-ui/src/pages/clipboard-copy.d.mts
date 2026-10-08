export function copyText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined, document: Document): Promise<boolean>;
