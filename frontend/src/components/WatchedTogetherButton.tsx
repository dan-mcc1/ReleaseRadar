import { useState, type ComponentProps } from "react";
import { Button, UsersIcon } from "./ui";
import WatchedTogetherModal, { type LogTarget } from "./WatchedTogetherModal";
import { useHouseholds } from "../hooks/api/useHouseholds";

interface Props extends Omit<ComponentProps<typeof Button>, "onClick" | "children"> {
  target: LogTarget;
}

/** "Watched together…": opens the who-watched dialog. Renders nothing without a household. */
export default function WatchedTogetherButton({ target, ...buttonProps }: Props) {
  const { data } = useHouseholds();
  const [open, setOpen] = useState(false);
  if (!data?.households.length) return null;
  return (
    <>
      <Button icon={<UsersIcon />} {...buttonProps} onClick={() => setOpen(true)}>
        Watched together…
      </Button>
      <WatchedTogetherModal open={open} onClose={() => setOpen(false)} target={target} />
    </>
  );
}
