import type { Chapter, ScenarioReport, Site, TranscriptCue } from './types';

export const DURATION = 175;
export const APPROVAL_TIME = 110;

export const SCENARIO_SOURCE = '/scenario-notes.html';

// Real geographic anchors, fictional emergency operations. The stadium marker
// approximates a parking area, not an operating aid site or a verified entrance.
// All report locations below are illustrative, not the locations of real callers.
export const SITES: { school: Site; destination: Site } = {
  school: {
    id: 'school',
    name: 'John Marshall High School',
    shortName: 'Marshall High',
    address: '3939 Tracy Street',
    lat: 34.1079254,
    lon: -118.2773743,
    coordinateSource: 'Esri POI cross-check · approximate scenario marker; fictional aid operation',
  },
  destination: {
    id: 'destination',
    name: 'Dodger Stadium parking lot',
    shortName: '1000 Vin Scully Avenue',
    address: '1000 Vin Scully Avenue',
    lat: 34.0716,
    lon: -118.2475,
    coordinateSource: 'Esri POI cross-check · approximate scenario marker; fictional aid operation',
  },
};

export const CHAPTERS: Chapter[] = [
  {
    id: 'arrival', number: '01', start: 0, end: 12,
    label: 'Arrival', title: 'Los Angeles, after the storm',
    subtitle: 'Hypothetical aftermath · Rachel · fictional scenario',
  },
  {
    id: 'reports', number: '02', start: 12, end: 40,
    label: 'Reports', title: 'A city of questions',
    subtitle: 'Prepared reports establish context, not verified conditions.',
  },
  {
    id: 'question', number: '03', start: 40, end: 65,
    label: 'One question', title: 'Where is food and water distribution now?',
    subtitle: 'Repeated messages are not independent confirmation.',
  },
  {
    id: 'verification', number: '04', start: 65, end: 110,
    label: 'Verification', title: 'Check with the source',
    subtitle: 'Scripted reenactment · proposed facts await review',
  },
  {
    id: 'review', number: '05', start: 110, end: 140,
    label: 'Review', title: 'One reviewed update changes the map',
    subtitle: 'A supervisor approves the location; closing time stays unknown.',
  },
  {
    id: 'answer', number: '06', start: 140, end: DURATION,
    label: 'Next caller', title: 'The next caller gets the corrected answer',
    subtitle: 'The response and map use the same approved record.',
  },
];

// Repeated originId values deliberately identify declared reposts. They are
// fixture metadata, not inferred relationships or real-world source identities.
export const REPORTS: ScenarioReport[] = [
  {
    id: 'school-original', at: 14, title: 'Water listed at the school',
    detail: '“Hi, I need some drinking water. Is pickup still at John Marshall High?” A scripted caller asks the hotline to check its listing.',
    area: 'Los Feliz', category: 'water',
    source: 'Prepared caller message · school bulletin repost',
    originId: 'school-bulletin-a', tone: 'amber', relatedSite: 'school',
    lat: SITES.school.lat + 0.002, lon: SITES.school.lon - 0.003,
  },
  {
    id: 'power-west', at: 17, title: 'Coastal flooding and power loss',
    detail: 'In this fictional stronger-storm scenario, Rachel drives coastal flooding and wind damage near Santa Monica. A prepared report describes dark blocks and damaged storefronts; the extent is unverified.',
    area: 'Santa Monica', category: 'power', source: 'Prepared neighborhood report',
    originId: 'context-power-west', tone: 'red', lat: 34.014, lon: -118.492,
  },
  {
    id: 'access-river', at: 20, title: 'Flooded river crossing reported',
    detail: 'A fictional field note reports floodwater and storm debris near a Los Angeles River crossing. The exact closure and water depth have not been checked.',
    area: 'Los Angeles River', category: 'access', source: 'Prepared field note',
    originId: 'context-access-river', tone: 'red', lat: 34.079, lon: -118.223,
  },
  {
    id: 'hours-north', at: 23, title: 'Shelter hours need confirmation',
    detail: 'A scripted Pasadena request asks about shelter hours after wind damage and outages. No opening or closing time is established.',
    area: 'Pasadena', category: 'hours', source: 'Prepared information request',
    originId: 'context-hours-north', tone: 'amber', lat: 34.146, lon: -118.145,
  },
  {
    id: 'school-repost-one', at: 26, title: 'School listing shared again',
    detail: 'Explicit repost of the same school bulletin. Another message, not another independent origin.',
    area: 'Los Feliz', category: 'water', source: 'Prepared community repost',
    originId: 'school-bulletin-a', tone: 'amber', relatedSite: 'school',
    lat: SITES.school.lat - 0.003, lon: SITES.school.lon - 0.006,
  },
  {
    id: 'power-east', at: 29, title: 'Wind damage cuts power',
    detail: 'A fictional East LA caller reports fallen branches and interrupted power after Rachel. Restoration time and the outage boundary remain unconfirmed.',
    area: 'East Los Angeles', category: 'power', source: 'Prepared caller message',
    originId: 'context-power-east', tone: 'red', lat: 34.035, lon: -118.18,
  },
  {
    id: 'relocation-original', at: 32, title: 'Pickup may have moved',
    detail: '“Someone says pickup moved.” A scripted neighborhood message introduces an unresolved location change.',
    area: 'Los Feliz', category: 'water', source: 'Prepared neighborhood message',
    originId: 'relocation-note-b', tone: 'amber', relatedSite: 'destination',
    lat: 34.091, lon: -118.26,
  },
  {
    id: 'access-south', at: 35, title: 'Underpass flooding reported',
    detail: 'A fictional South LA caller reports water in an underpass after intense rain. Passability has not been verified; no travel route is supplied.',
    area: 'South Los Angeles', category: 'access', source: 'Prepared information request',
    originId: 'context-access-south', tone: 'red', lat: 33.987, lon: -118.281,
  },
  {
    id: 'hours-central', at: 38, title: 'Conflicting posted hours',
    detail: 'Illustrative community note describes differing aid-desk hours. Neither version is treated as verified.',
    area: 'Downtown', category: 'hours', source: 'Prepared community note',
    originId: 'context-hours-central', tone: 'amber', lat: 34.048, lon: -118.253,
  },
  {
    id: 'school-repost-two', at: 43, title: 'Same school bulletin, third message',
    detail: 'Another explicit repost of school-bulletin-a. The declared origin remains the same.',
    area: 'Los Feliz', category: 'water', source: 'Prepared caller repost',
    originId: 'school-bulletin-a', tone: 'amber', relatedSite: 'school',
    lat: SITES.school.lat + 0.004, lon: SITES.school.lon + 0.004,
  },
  {
    id: 'relocation-repost', at: 49, title: 'Relocation note repeated',
    detail: 'Explicit repost of relocation-note-b. The repeated claim still needs a source check.',
    area: 'Echo Park', category: 'water', source: 'Prepared community repost',
    originId: 'relocation-note-b', tone: 'amber', relatedSite: 'destination',
    lat: 34.084, lon: -118.257,
  },
  {
    id: 'destination-field-note', at: 57, title: 'Supplies reported at Dodger Stadium',
    detail: '“I collected supplies at the Dodger Stadium parking lot.” This independent scripted report is a lead, not verification.',
    area: 'Elysian Park', category: 'water', source: 'Prepared firsthand-style field note',
    originId: 'destination-note-c', tone: 'amber', relatedSite: 'destination',
    lat: SITES.destination.lat + 0.001, lon: SITES.destination.lon + 0.002,
  },
];

export const SPEAKER_LABELS = {
  Guide: 'Your role', Agent: 'Hotline assistant', Coordinator: 'Site coordinator', Caller: 'Resident caller',
};

export const CONTEXT_CUES: TranscriptCue[] = [
  {id:'mission-intro', start:1, end:14, speaker:'Guide', text:'In this fictional scenario, Hurricane Rachel has hit Los Angeles. You’re running the hotline. A caller needs water, but the pickup address may have changed.'},
  {id:'resident-first-question', start:14, end:23, speaker:'Caller', text:'Hi, I need some drinking water. Is pickup still at John Marshall High?'},
  {id:'mission-question', start:44, end:55, speaker:'Guide', text:'Some people say the school. Others say pickup has moved. Let’s call the coordinator and check which address is right.'},
];

// Prepared speech and captions, not live calls or model-generated extraction.
export const VERIFICATION_CUES: TranscriptCue[] = [
  {
    id: 'verify-question', start: 65, end: 71.8, speaker: 'Agent',
    text: 'Hi, I’m checking the water pickup location for our hotline. Are you still at John Marshall High?',
  },
  {
    id: 'verify-address', start: 71.8, end: 78.6, speaker: 'Coordinator',
    text: 'We’ve moved to the Dodger Stadium parking lot, at 1000 Vin Scully Avenue.',
    evidenceFields: ['location', 'address'],
  },
  {
    id: 'verify-former-site', start: 78.6, end: 82.5, speaker: 'Coordinator',
    text: 'Flooding closed our pickup site at the school.',
    evidenceFields: ['previousLocation'],
  },
  {
    id: 'verify-supplies', start: 82.5, end: 86.3, speaker: 'Coordinator',
    text: 'You can get food and drinking water here.', evidenceFields: ['supplies'],
  },
  {
    id: 'verify-hours-question', start: 86.3, end: 93, speaker: 'Agent',
    text: "Okay, 1000 Vin Scully Avenue, instead of the school. What time do you close today?",
  },
  {
    id: 'verify-hours-unknown', start: 93, end: APPROVAL_TIME, speaker: 'Coordinator',
    text: "I don’t have a confirmed closing time yet.", evidenceFields: ['closingTime'],
  },
];
