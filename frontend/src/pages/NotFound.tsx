import { useLocation } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { ButtonLink, PageHeader } from "../components/ui";

export default function NotFound() {
  usePageTitle("Page not found");
  const { pathname } = useLocation();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-24 text-center">
      <PageHeader title="Page not found" className="justify-center" />
      <p className="text-neutral-400 leading-relaxed my-8">
        We couldn't find anything at{" "}
        <code className="text-neutral-300 bg-neutral-900 px-1.5 py-0.5 rounded">
          {pathname}
        </code>
        . The link might be broken, or the page may have moved.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink to="/" variant="primary">
          Back to home
        </ButtonLink>
        <ButtonLink to="/search">Search</ButtonLink>
        <ButtonLink to="/trending">What's trending</ButtonLink>
      </div>
    </div>
  );
}
