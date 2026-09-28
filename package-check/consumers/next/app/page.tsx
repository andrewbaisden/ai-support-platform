import type { WidgetPosition } from "@issuerelay/widget";
import { Support } from "./support";

// A Server Component: it may import the package's types, and renders the
// widget through the host's own client component (the usual pattern, since
// a submission client is not serializable across the server boundary).
const position: WidgetPosition = "bottom-left";

export default function Page() {
  return (
    <main>
      <h1>External Next.js consumer</h1>
      <Support position={position} />
    </main>
  );
}
