export function buildThreadUrl(platform: string, videoId?: string | null, metadata?: any): string | null {
    const pageUrl = typeof metadata?.page?.url === 'string'
        ? metadata.page.url
        : typeof metadata?.page_url === 'string'
            ? metadata.page_url
            : null;
    const videoUrl = typeof metadata?.video?.video_url === 'string'
        ? metadata.video.video_url
        : typeof metadata?.video_url === 'string'
            ? metadata.video_url
            : null;

    if (pageUrl) return pageUrl;
    if (videoUrl) return videoUrl;
    if (!videoId) return null;

    if (platform === 'rednote' || platform === 'xiaohongshu') {
        return `https://www.xiaohongshu.com/explore/${videoId}`;
    }

    return null;
}

export function buildThreadReference(input: {
    platform: string;
    videoId?: string | null;
    commentId?: string | null;
    userHandle?: string | null;
    userProfileUrl?: string | null;
    metadata?: any;
}) {
    return {
        platform: input.platform,
        video_id: input.videoId || null,
        comment_id: input.commentId || null,
        user_handle: input.userHandle || null,
        user_profile_url: input.userProfileUrl || null,
        thread_url: buildThreadUrl(input.platform, input.videoId, input.metadata),
    };
}
