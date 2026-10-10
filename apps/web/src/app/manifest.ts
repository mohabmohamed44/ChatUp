import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'ChatUp',
        short_name: 'ChatUp',
        description: 'Real-time messaging',
        start_url: '/',
        display: 'standalone',
        background_color: "#f8fafc",
        theme_color: '#0f172a',
        icons: [
            { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}