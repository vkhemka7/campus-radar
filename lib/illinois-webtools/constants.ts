export const ILLINOIS_WEBTOOLS_SOURCE = "Illinois Webtools";

export const SIEBEL_MASTER_CALENDAR_ID = "2654";

export const COLLECTOR_USER_AGENT =
  "CampusRadar/0.1 (educational UIUC event collector)";

export type WebtoolsCalendar = { id: string; label: string };

// Production source set; discovery uses public list/detail pages only.
export const WEBTOOLS_CALENDARS: readonly WebtoolsCalendar[] = [
  { id: SIEBEL_MASTER_CALENDAR_ID, label: "Siebel" },
  { id: "1551", label: "HireIllini Career Fairs" },
  { id: "5115", label: "Research Park" },
  { id: "6499", label: "LAS Career Services" },
  { id: "6805", label: "ECE Student Events" },
  { id: "7541", label: "AE Corporate Relations" },
  { id: "6327", label: "Illinois Entrepreneurship Master" },
];
