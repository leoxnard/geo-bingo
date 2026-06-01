import { MetadataRoute } from 'next';

// Crawlers may index everything; the dynamic /game/[id] rooms opt out of
// indexing via their own layout's robots metadata (they have no SEO value and
// are infinite/private). robots.txt just advertises the sitemap.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
        },
        sitemap: 'https://geobingbong.leonardsima.de/sitemap.xml',
        host: 'https://geobingbong.leonardsima.de',
    };
}
