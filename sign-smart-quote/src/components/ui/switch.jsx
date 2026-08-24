import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center overflow-hidden rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className={cn(
        // translate-x is a PHYSICAL direction and this app is RTL: the thumb
        // already sits at the right edge when off, so translating it further
        // right on check pushed it out of the track and overflow-hidden clipped
        // it away entirely. An "on" switch therefore rendered as a plain
        // coloured pill with no thumb at all, leaving colour as the only
        // difference between on and off. margin-inline-start is logical, so it
        // moves the thumb the correct way in both directions.
        "pointer-events-none block h-4 w-4 rounded-full bg-background border border-black/20 shadow-lg ring-0 transition-[margin] data-[state=checked]:ms-4 data-[state=unchecked]:ms-0"
      )} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
