// The ONLY markdown renderer in the app, with the safety configuration
// hard-coded:
//  - react-markdown never emits raw HTML (no rehype-raw here, ever)
//  - rehype-sanitize as defence in depth
//  - urlTransform allowlists http/https/mailto, killing javascript:/data:/file:
//  - links open via the audited open_external_url command
//  - images are not loaded (asset protocol is disabled); alt text shows instead
//  - task-list checkboxes render read-only
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useAppStore } from "../store/useAppStore";
import styles from "./MarkdownView.module.css";

function urlTransform(url: string): string {
  return /^(https?:|mailto:)/i.test(url) ? url : "";
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, defaultSchema]]}
        urlTransform={urlTransform}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (/^https?:/i.test(href)) void openExternalUrl(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span className={styles.imagePlaceholder}>🖼 {alt || "image"}</span>,
          input: (props) => <input {...props} disabled readOnly />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
