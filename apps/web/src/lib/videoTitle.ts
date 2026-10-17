/**
 * Recordings start with a title made from the date ("Recording Oct 17, 2026,
 * 8:12 PM", see components/Recorder.tsx and api/videos). Until it's changed,
 * it says nothing a client can use, so emails leave it out and the Send box
 * offers to name it.
 */
export const isDefaultTitle = (title: string) => /^Recording [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M$/.test(title.trim()) || title.trim() === "Untitled recording";
