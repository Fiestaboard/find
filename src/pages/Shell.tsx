/**
 * The frame every page shares: the FiestaBoard lockup, one card holding the
 * page's single task, and a quiet line of links beneath it. The same shape
 * as the product's own sign-in screen, so the hand-off from a board to this
 * site and back does not look like a change of product.
 */
import { Box, Card, CardDescription, CardHeader, CardTitle, FiestaIcon, FiestaLogo, Flex, Stack, TextLink } from "../ui";
import type { ReactNode, Ref } from "react";

const README_URL = "https://github.com/Fiestaboard/find#readme";

export function Shell({ children, links }: { children: ReactNode; links?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 sm:py-12">
      <Stack gap="6" align="center" className="w-full max-w-md">
        <Flex align="center" gap="3">
          <FiestaIcon size={36} className="shrink-0" />
          <FiestaLogo className="text-2xl" />
        </Flex>
        <Card className="w-full shadow-modal">{children}</Card>
        <Box as="footer" className="w-full">
          <Flex wrap justify="center" gap="4" className="text-xs">
            {links}
            <TextLink href={README_URL}>How this works</TextLink>
          </Flex>
        </Box>
      </Stack>
    </main>
  );
}

/**
 * The page's one h1, with the line under it. Focusable so a view change can
 * move focus to it; the outline is dropped because the focus is programmatic
 * and the heading is not a control.
 *
 * The icon slot is decorative (CardTitle hides it from assistive technology).
 * It is top-aligned and sized to the heading's 20px line so that a heading
 * which wraps on a phone keeps the glyph on its first line.
 */
export function PageHeading({
  children,
  description,
  icon,
  ref,
}: {
  children: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  ref?: Ref<HTMLHeadingElement>;
}) {
  return (
    <CardHeader>
      <CardTitle
        as="h1"
        ref={ref}
        tabIndex={-1}
        icon={icon}
        className="text-xl text-balance outline-none items-start [&_svg:not([class*='size-'])]:size-5"
      >
        {children}
      </CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
  );
}
