import { Disclosure } from '@/onboarding/Disclosure';

// Route wrapper so the onboarding component is reachable as /disclosure.
// Presented as a modal (see app/_layout.tsx). In M2 this route is shown
// automatically before the first OS permission prompt.
export default function DisclosureRoute() {
  return <Disclosure />;
}
