/**
 * Spyfall — the deck.
 *
 * Sixteen locations, each with a role for every seat at a table of up to eight
 * (a crowded train carriage is the one place where eight strangers is normal).
 * The roles are deliberately ordinary jobs and bystanders: the game is about
 * knowing what a place *feels* like, not about being an expert.
 *
 * The interrogation prompts exist because the hardest part of Spyfall for a new
 * table is the first question. They are generic enough to be answerable by an
 * agent who knows the place and by a spy who is bluffing, which is the point.
 */

export interface Location {
  id: string;
  name: string;
  /** one line of atmosphere, shown on the reveal card */
  blurb: string;
  /** eight roles — seat i takes roles[i] */
  roles: string[];
}

export const LOCATIONS: Location[] = [
  {
    id: 'casino', name: 'Casino',
    blurb: 'Carpet that swallows sound, and no clocks on the wall.',
    roles: ['Dealer', 'Pit boss', 'High roller', 'Barman', 'Security guard', 'Waiter', 'Cashier', 'Cleaner'],
  },
  {
    id: 'hospital', name: 'Hospital',
    blurb: 'Corridors that smell of disinfectant and coffee.',
    roles: ['Surgeon', 'Nurse', 'Patient', 'Anaesthetist', 'Porter', 'Visitor', 'Pharmacist', 'Cleaner'],
  },
  {
    id: 'airport', name: 'Airport',
    blurb: 'Everything is a queue and a screen.',
    roles: ['Pilot', 'Check-in agent', 'Passenger', 'Customs officer', 'Baggage handler', 'Barista', 'Security guard', 'Cleaner'],
  },
  {
    id: 'yacht', name: 'Yacht',
    blurb: 'Fibreglass, salt and someone else’s money.',
    roles: ['Captain', 'Deckhand', 'Owner', 'Guest', 'Chef', 'Steward', 'Photographer', 'Engineer'],
  },
  {
    id: 'school', name: 'School',
    blurb: 'Bells, lino and the smell of pencil sharpenings.',
    roles: ['Teacher', 'Pupil', 'Head teacher', 'Janitor', 'Librarian', 'Parent', 'Canteen cook', 'Supply teacher'],
  },
  {
    id: 'train', name: 'Train',
    blurb: 'A corridor that rocks, and a trolley that never arrives.',
    roles: ['Driver', 'Guard', 'Commuter', 'Ticket inspector', 'Trolley attendant', 'Tourist', 'Sleeper passenger', 'Engineer'],
  },
  {
    id: 'restaurant', name: 'Restaurant',
    blurb: 'Low light, loud room, one table always waiting.',
    roles: ['Chef', 'Waiter', 'Sommelier', 'Diner', 'Food critic', 'Host', 'Kitchen porter', 'Manager'],
  },
  {
    id: 'museum', name: 'Museum',
    blurb: 'Polished floors and the hush of people reading labels.',
    roles: ['Curator', 'Guard', 'Visitor', 'Restorer', 'Guide', 'Photographer', 'Cleaner', 'Ticket clerk'],
  },
  {
    id: 'stadium', name: 'Stadium',
    blurb: 'Concrete ramps, floodlights, and a roar you feel in your chest.',
    roles: ['Player', 'Referee', 'Steward', 'Coach', 'Commentator', 'Vendor', 'Groundskeeper', 'Physio'],
  },
  {
    id: 'hotel', name: 'Hotel',
    blurb: 'Carpet in a pattern you cannot describe afterwards.',
    roles: ['Receptionist', 'Guest', 'Concierge', 'Housekeeper', 'Bellboy', 'Manager', 'Chef', 'Security guard'],
  },
  {
    id: 'submarine', name: 'Submarine',
    blurb: 'Pipes on every surface and nobody raises their voice.',
    roles: ['Captain', 'Sonar operator', 'Cook', 'Engineer', 'Navigator', 'Torpedo operator', 'Medic', 'Radio operator'],
  },
  {
    id: 'lab', name: 'Laboratory',
    blurb: 'Cold rooms, labelled drawers, and one bench nobody touches.',
    roles: ['Lead scientist', 'Technician', 'PhD student', 'Cleaner', 'Safety officer', 'Visitor', 'Lab manager', 'Security guard'],
  },
  {
    id: 'theatre', name: 'Theatre',
    blurb: 'Velvet, dust and the smell of the heating coming on.',
    roles: ['Actor', 'Stagehand', 'Director', 'Usher', 'Audience member', 'Lighting tech', 'Dresser', 'Box office clerk'],
  },
  {
    id: 'farm', name: 'Farm',
    blurb: 'Mud, diesel and a dog that has decided you are suspicious.',
    roles: ['Farmer', 'Vet', 'Tractor driver', 'Farmhand', 'Buyer', 'Inspector', 'Delivery driver', 'Sheep'],
  },
  {
    id: 'beach', name: 'Beach',
    blurb: 'Wind, sand in everything, and a flag nobody reads.',
    roles: ['Lifeguard', 'Surfer', 'Ice-cream seller', 'Tourist', 'Fisherman', 'Beach cleaner', 'Photographer', 'Dog walker'],
  },
  {
    id: 'space station', name: 'Space Station',
    blurb: 'Velcro everywhere, and a view that stops conversation.',
    roles: ['Commander', 'Flight engineer', 'Scientist', 'Doctor', 'Mission control', 'Visitor', 'Pilot', 'Cook'],
  },
];

/**
 * Interrogation prompts. A question is only useful if both a spy and an agent can
 * answer it without a lie collapsing immediately — so they ask about *habits and
 * feelings*, not facts a search engine could settle.
 */
export const QUESTIONS: string[] = [
  'How long has it been since you last came here?',
  'What is the floor like under your feet?',
  'Who do you talk to most here, and why?',
  'What is the loudest thing in the room right now?',
  'What would you never do here, and why not?',
  'What time of day is it when it gets busy?',
  'What is the last thing you touched?',
  'How would you describe the smell to a friend?',
  'What happens if you are late?',
  'Who is in charge here, and do you trust them?',
  'What is the worst thing about your job today?',
  'What did you eat last, and where?',
  'What do people do while they wait?',
  'What is the one rule nobody breaks?',
  'How do you leave at the end of the day?',
  'What have you been carrying around with you?',
];

export const LOCATION_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

/** Roles available up to `seats`, in a fixed order so deals are reproducible. */
export const rolesFor = (location: Location, seats: number): string[] =>
  location.roles.slice(0, Math.max(3, Math.min(8, seats)));
