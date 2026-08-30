export function normalizeBaseURL(api_url: string): string {
    api_url = api_url.trim().replace(/\/+$/, '');
    if (!api_url) {
        return '';
    }
    if (/\/v\d+$/.test(api_url)) {
        return api_url;
    }
    if (api_url.endsWith('/models')) {
        return api_url.replace(/\/models$/, '');
    }
    if (api_url.endsWith('/chat/completions')) {
        return api_url.replace(/\/chat\/completions$/, '');
    }
    return `${api_url}/v1`;
}
