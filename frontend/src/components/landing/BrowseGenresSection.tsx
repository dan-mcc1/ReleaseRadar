import { ButtonLink, ChevronRightIcon, SectionHeader } from "../ui";

export default function BrowseGenresSection() {
  return (
    <section aria-labelledby="landing-genres">
      <SectionHeader id="landing-genres" title="Browse by genre" className="mb-4" />
      <ButtonLink to="/browse-genres" icon={<ChevronRightIcon />}>
        All genres
      </ButtonLink>
    </section>
  );
}
