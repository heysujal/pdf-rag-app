import { FileUpload } from "./components/file-upload";
import { QueryInput } from "./components/query-input";

export default function Home() {
  return (<div>
    <section className="min-h-screen flex">
      
      <div className="min-h-screen w-[70vw]">
        <FileUpload />
      </div>
      <div className="min-h-screen border-l-2 w-full">
        <QueryInput/>
      </div>
    </section>
  </div>
  );
}
