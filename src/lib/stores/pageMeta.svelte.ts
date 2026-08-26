/** Title and subtitle rendered by the top bar; each page sets its own. */
class PageMeta {
	title = $state('Overview');
	subtitle = $state<string | undefined>(undefined);
}

export const pageMeta = new PageMeta();

export function setPageMeta(title: string, subtitle?: string) {
	pageMeta.title = title;
	pageMeta.subtitle = subtitle;
}
