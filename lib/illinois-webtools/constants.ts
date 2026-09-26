export const ILLINOIS_WEBTOOLS_SOURCE = "Illinois Webtools";

export const SIEBEL_MASTER_CALENDAR_ID = "2654";

export const SIEBEL_MASTER_ICS_URL =
  "https://calendars.illinois.edu/icalOutlook/2654.ics";

export const COLLECTOR_USER_AGENT =
  "CampusRadar/0.1 (educational UIUC event collector)";

export type WebtoolsCalendar = { id: string; label: string; url: string };

// Order is also the precedence for conflicting nonempty feed fields.
export const WEBTOOLS_CALENDARS: readonly WebtoolsCalendar[] = [
  { id: SIEBEL_MASTER_CALENDAR_ID, label: "Siebel", url: SIEBEL_MASTER_ICS_URL },
  { id: "1551", label: "HireIllini Career Fairs", url: "https://calendars.illinois.edu/icalOutlook/1551.ics" },
  { id: "5115", label: "Research Park", url: "https://calendars.illinois.edu/icalOutlook/5115.ics" },
  { id: "6499", label: "LAS Career Services", url: "https://calendars.illinois.edu/icalOutlook/6499.ics" },
  { id: "6805", label: "ECE Student Events", url: "https://calendars.illinois.edu/icalOutlook/6805.ics" },
];
