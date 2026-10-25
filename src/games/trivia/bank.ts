/**
 * Trivia question bank.
 *
 * Hand-written so there is no licensing question and no network call at play time:
 * every question ships in the bundle and the game works fully offline.
 * Maths is *generated* instead (see `rules.ts`) so it never runs out and the
 * difficulty tiers can be genuinely different rather than just "rarer questions".
 *
 * Answer convention: `a[0]` is always the correct answer. The view shuffles.
 */

export type Category = 'science' | 'history' | 'general' | 'maths' | 'geography' | 'nature' | 'philippines' | 'society';
export type Tier = 1 | 2 | 3;

export interface Question {
  q: string;
  /** a[0] is correct */
  a: [string, string, string, string];
  cat: Category;
  tier: Tier;
  /** shown after answering — the bit that makes a quiz worth playing */
  note?: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  science: 'Science',
  history: 'History',
  general: 'General knowledge',
  maths: 'Mental maths',
  geography: 'Geography',
  nature: 'Animals & nature',
  philippines: 'Filipino general knowledge',
  society: 'People & society',
};

export const BANK: Question[] = [
  /* ──────────────────── geography ──────────────────── */
  { q: 'Which is the longest river in the world by most measures?', a: ['The Nile', 'The Amazon', 'The Yangtze', 'The Mississippi'], cat: 'geography', tier: 2,
    note: 'The Nile and the Amazon trade places depending on where you decide the Amazon begins.' },
  { q: 'What is the capital of Australia?', a: ['Canberra', 'Sydney', 'Melbourne', 'Perth'], cat: 'geography', tier: 2,
    note: 'Chosen as a compromise because Sydney and Melbourne both wanted it.' },
  { q: 'Which country has the most natural lakes?', a: ['Canada', 'Russia', 'Finland', 'Brazil'], cat: 'geography', tier: 3 },
  { q: 'Mount Everest sits on the border between Nepal and which other country?', a: ['China', 'India', 'Bhutan', 'Pakistan'], cat: 'geography', tier: 1 },
  { q: 'Which desert is the largest hot desert on Earth?', a: ['The Sahara', 'The Gobi', 'The Kalahari', 'The Mojave'], cat: 'geography', tier: 1 },
  { q: 'Which ocean is the deepest?', a: ['The Pacific', 'The Atlantic', 'The Indian', 'The Arctic'], cat: 'geography', tier: 1,
    note: 'The Mariana Trench reaches nearly 11 km down.' },
  { q: 'Which city is split between Europe and Asia?', a: ['Istanbul', 'Athens', 'Cairo', 'Moscow'], cat: 'geography', tier: 2 },
  { q: 'What is the smallest country in the world by area?', a: ['Vatican City', 'Monaco', 'San Marino', 'Liechtenstein'], cat: 'geography', tier: 1 },
  { q: 'Which country is home to the city of Marrakesh?', a: ['Morocco', 'Algeria', 'Tunisia', 'Egypt'], cat: 'geography', tier: 2 },
  { q: 'The Great Barrier Reef lies off the coast of which country?', a: ['Australia', 'Indonesia', 'Fiji', 'New Zealand'], cat: 'geography', tier: 1 },
  { q: 'Which is the largest island in the world?', a: ['Greenland', 'New Guinea', 'Borneo', 'Madagascar'], cat: 'geography', tier: 2,
    note: 'Australia is larger but counts as a continent.' },
  { q: 'Which two countries share the longest land border?', a: ['Canada and the USA', 'Russia and China', 'Chile and Argentina', 'India and China'], cat: 'geography', tier: 3 },
  { q: 'What is the capital of Japan?', a: ['Tokyo', 'Kyoto', 'Osaka', 'Nagoya'], cat: 'geography', tier: 1 },
  { q: 'Which sea is the saltiest large body of water on Earth?', a: ['The Dead Sea', 'The Red Sea', 'The Caspian Sea', 'The Black Sea'], cat: 'geography', tier: 2 },
  { q: 'Which continent has no permanent human residents?', a: ['Antarctica', 'Australia', 'South America', 'Africa'], cat: 'geography', tier: 1 },
  { q: 'Kerala is a state in which country?', a: ['India', 'Sri Lanka', 'Bangladesh', 'Nepal'], cat: 'geography', tier: 1 },
  { q: 'Which river runs through Paris?', a: ['The Seine', 'The Loire', 'The Rhone', 'The Danube'], cat: 'geography', tier: 1 },
  { q: 'Which mountain range separates Europe from Asia?', a: ['The Urals', 'The Alps', 'The Carpathians', 'The Caucasus'], cat: 'geography', tier: 2 },
  { q: 'What is the most populous city in the world by metropolitan area?', a: ['Tokyo', 'Delhi', 'Shanghai', 'Sao Paulo'], cat: 'geography', tier: 3 },
  { q: 'Iceland sits on the boundary of which two tectonic plates?', a: ['North American and Eurasian', 'Pacific and Nazca', 'African and Indian', 'Antarctic and Australian'], cat: 'geography', tier: 3 },

  /* ──────────────────── animals & nature ──────────────────── */
  { q: 'What is the largest animal that has ever lived?', a: ['The blue whale', 'The African elephant', 'The argentinosaurus', 'The giant squid'], cat: 'nature', tier: 1 },
  { q: 'How many hearts does an octopus have?', a: ['Three', 'One', 'Two', 'Five'], cat: 'nature', tier: 2,
    note: 'Two pump blood to the gills and one to the rest of the body.' },
  { q: 'Which bird is the fastest animal on Earth in a dive?', a: ['The peregrine falcon', 'The golden eagle', 'The swift', 'The albatross'], cat: 'nature', tier: 2,
    note: 'It exceeds 300 km/h in a stoop.' },
  { q: 'What is a group of crows called?', a: ['A murder', 'A parliament', 'A gaggle', 'A pride'], cat: 'nature', tier: 2 },
  { q: 'Which mammal is the only one capable of true sustained flight?', a: ['The bat', 'The flying squirrel', 'The colugo', 'The sugar glider'], cat: 'nature', tier: 1 },
  { q: 'How long is an elephant pregnant for, roughly?', a: ['22 months', '9 months', '14 months', '30 months'], cat: 'nature', tier: 3 },
  { q: 'What colour is a polar bear\u2019s skin underneath its fur?', a: ['Black', 'White', 'Pink', 'Grey'], cat: 'nature', tier: 2,
    note: 'The fur is actually translucent, not white.' },
  { q: 'Which animal has the longest lifespan of any known vertebrate?', a: ['The Greenland shark', 'The giant tortoise', 'The bowhead whale', 'The koi carp'], cat: 'nature', tier: 3 },
  { q: 'What do you call an animal that is active mainly at dawn and dusk?', a: ['Crepuscular', 'Nocturnal', 'Diurnal', 'Vespertine'], cat: 'nature', tier: 3 },
  { q: 'Honey never spoils mainly because it is?', a: ['Very low in water and acidic', 'Full of preservatives', 'Kept frozen', 'Sterile when sealed'], cat: 'nature', tier: 2 },
  { q: 'Which big cat cannot roar?', a: ['The cheetah', 'The lion', 'The tiger', 'The jaguar'], cat: 'nature', tier: 2,
    note: 'Cheetahs purr and chirp instead.' },
  { q: 'What is the tallest species of tree?', a: ['The coast redwood', 'The giant sequoia', 'The Douglas fir', 'The mountain ash'], cat: 'nature', tier: 2 },
  { q: 'Which insect is responsible for pollinating most food crops?', a: ['The bee', 'The butterfly', 'The beetle', 'The moth'], cat: 'nature', tier: 1 },
  { q: 'A seahorse is unusual because which parent carries the eggs?', a: ['The male', 'The female', 'Both equally', 'Neither, they are buried'], cat: 'nature', tier: 1 },
  { q: 'What is the hardest natural substance produced by a living thing?', a: ['Tooth enamel', 'Bone', 'Antler', 'Shell'], cat: 'nature', tier: 3 },
  { q: 'Which animal sleeps standing up and only briefly?', a: ['The giraffe', 'The sloth', 'The hippo', 'The otter'], cat: 'nature', tier: 2 },
  { q: 'What do caterpillars turn into inside a chrysalis?', a: ['Butterflies', 'Moths only', 'Beetles', 'Dragonflies'], cat: 'nature', tier: 1 },
  { q: 'Which ocean creature is famous for regrowing lost arms?', a: ['The starfish', 'The jellyfish', 'The clownfish', 'The eel'], cat: 'nature', tier: 1 },

  /* ──────────────────── more science ──────────────────── */
  { q: 'What force keeps planets in orbit around the Sun?', a: ['Gravity', 'Magnetism', 'Friction', 'Inertia alone'], cat: 'science', tier: 1 },
  { q: 'What is the chemical formula for table salt?', a: ['NaCl', 'KCl', 'NaHCO3', 'CaCl2'], cat: 'science', tier: 1 },
  { q: 'Which part of the atom carries a negative charge?', a: ['The electron', 'The proton', 'The neutron', 'The nucleus'], cat: 'science', tier: 1 },
  { q: 'What is the freezing point of water in Fahrenheit?', a: ['32 degrees', '0 degrees', '100 degrees', '212 degrees'], cat: 'science', tier: 2 },
  { q: 'Which scientist proposed the three laws of motion?', a: ['Isaac Newton', 'Albert Einstein', 'Galileo Galilei', 'Niels Bohr'], cat: 'science', tier: 1 },
  { q: 'What does DNA stand for?', a: ['Deoxyribonucleic acid', 'Dinucleic acid', 'Diribonucleic acid', 'Deoxyribose nucleotide'], cat: 'science', tier: 2 },
  { q: 'Which planet is the hottest in our solar system?', a: ['Venus', 'Mercury', 'Mars', 'Jupiter'], cat: 'science', tier: 2,
    note: 'Its thick CO2 atmosphere traps heat, so it beats Mercury despite being further out.' },
  { q: 'What is the pH of a neutral solution at room temperature?', a: ['7', '0', '14', '1'], cat: 'science', tier: 1 },
  { q: 'Sound cannot travel through which of these?', a: ['A vacuum', 'Water', 'Steel', 'Air'], cat: 'science', tier: 1 },
  { q: 'What is the most abundant element in the universe?', a: ['Hydrogen', 'Helium', 'Oxygen', 'Carbon'], cat: 'science', tier: 1 },
  { q: 'Which organ produces insulin?', a: ['The pancreas', 'The liver', 'The kidney', 'The spleen'], cat: 'science', tier: 2 },
  { q: 'What type of energy is stored in a stretched spring?', a: ['Elastic potential', 'Kinetic', 'Thermal', 'Chemical'], cat: 'science', tier: 2 },
  { q: 'How many chromosomes does a typical human cell contain?', a: ['46', '23', '48', '44'], cat: 'science', tier: 2 },
  { q: 'What is the process by which a liquid becomes a gas below its boiling point?', a: ['Evaporation', 'Condensation', 'Sublimation', 'Precipitation'], cat: 'science', tier: 2 },
  { q: 'Which gas makes up the majority of the Sun?', a: ['Hydrogen', 'Helium', 'Oxygen', 'Neon'], cat: 'science', tier: 2 },
  { q: 'What unit measures electrical resistance?', a: ['The ohm', 'The volt', 'The amp', 'The watt'], cat: 'science', tier: 2 },
  { q: 'Which blood type is the universal donor for red cells?', a: ['O negative', 'AB positive', 'A positive', 'B negative'], cat: 'science', tier: 3 },
  { q: 'What phenomenon bends light as it passes from air into water?', a: ['Refraction', 'Reflection', 'Diffraction', 'Dispersion'], cat: 'science', tier: 2 },

  /* ──────────────────── more history ──────────────────── */
  { q: 'In which year did the Second World War end?', a: ['1945', '1944', '1946', '1939'], cat: 'history', tier: 1 },
  { q: 'Who was the first person to walk on the Moon?', a: ['Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins'], cat: 'history', tier: 1 },
  { q: 'The Great Wall was built primarily by which civilisation?', a: ['Chinese', 'Mongol', 'Japanese', 'Korean'], cat: 'history', tier: 1 },
  { q: 'Which ancient city was buried by the eruption of Mount Vesuvius in AD 79?', a: ['Pompeii', 'Athens', 'Carthage', 'Troy'], cat: 'history', tier: 2 },
  { q: 'Who wrote the Indian national anthem?', a: ['Rabindranath Tagore', 'Bankim Chandra Chatterjee', 'Sarojini Naidu', 'Mahatma Gandhi'], cat: 'history', tier: 2 },
  { q: 'In which year did India gain independence?', a: ['1947', '1950', '1945', '1935'], cat: 'history', tier: 1 },
  { q: 'Which empire was ruled by Genghis Khan?', a: ['The Mongol Empire', 'The Ottoman Empire', 'The Persian Empire', 'The Roman Empire'], cat: 'history', tier: 1 },
  { q: 'The Renaissance began in which country?', a: ['Italy', 'France', 'England', 'Spain'], cat: 'history', tier: 2 },
  { q: 'Who was the first woman to win a Nobel Prize?', a: ['Marie Curie', 'Rosalind Franklin', 'Dorothy Hodgkin', 'Ada Lovelace'], cat: 'history', tier: 2,
    note: 'She later became the only person to win in two different sciences.' },
  { q: 'Which wall divided a European capital until 1989?', a: ['The Berlin Wall', 'Hadrian\u2019s Wall', 'The Iron Curtain gate', 'The Vienna Wall'], cat: 'history', tier: 1 },
  { q: 'The printing press in Europe is credited to whom?', a: ['Johannes Gutenberg', 'Leonardo da Vinci', 'William Caxton', 'Benjamin Franklin'], cat: 'history', tier: 2 },
  { q: 'Which civilisation built Machu Picchu?', a: ['The Inca', 'The Maya', 'The Aztec', 'The Olmec'], cat: 'history', tier: 2 },
  { q: 'Cleopatra was the last active ruler of which kingdom?', a: ['Ptolemaic Egypt', 'Persia', 'Babylon', 'Nubia'], cat: 'history', tier: 3 },
  { q: 'What was the name of the ship that sank in 1912 on its maiden voyage?', a: ['The Titanic', 'The Lusitania', 'The Britannic', 'The Olympic'], cat: 'history', tier: 1 },
  { q: 'Which two cities were the first targets of atomic weapons?', a: ['Hiroshima and Nagasaki', 'Tokyo and Osaka', 'Kyoto and Kobe', 'Nagoya and Sendai'], cat: 'history', tier: 2 },

  /* ──────────────────── more general ──────────────────── */
  { q: 'How many strings does a standard guitar have?', a: ['Six', 'Four', 'Five', 'Seven'], cat: 'general', tier: 1 },
  { q: 'Which language has the most native speakers worldwide?', a: ['Mandarin Chinese', 'English', 'Spanish', 'Hindi'], cat: 'general', tier: 2 },
  { q: 'In chess, which piece can move in an L shape?', a: ['The knight', 'The bishop', 'The rook', 'The queen'], cat: 'general', tier: 1 },
  { q: 'How many players are on a football pitch per side at kick-off?', a: ['Eleven', 'Ten', 'Twelve', 'Nine'], cat: 'general', tier: 1 },
  { q: 'What is the most widely consumed beverage in the world after water?', a: ['Tea', 'Coffee', 'Beer', 'Milk'], cat: 'general', tier: 2 },
  { q: 'Which planet shares its name with a Roman god of war?', a: ['Mars', 'Venus', 'Jupiter', 'Mercury'], cat: 'general', tier: 1 },
  { q: 'How many keys does a standard full-size piano have?', a: ['88', '76', '96', '61'], cat: 'general', tier: 2 },
  { q: 'What does the \u201cwww\u201d in a web address stand for?', a: ['World Wide Web', 'Web Wide World', 'Wide World Web', 'World Web Wide'], cat: 'general', tier: 1 },
  { q: 'Which colour is made by mixing blue and yellow?', a: ['Green', 'Purple', 'Orange', 'Brown'], cat: 'general', tier: 1 },
  { q: 'How many sides does a hexagon have?', a: ['Six', 'Five', 'Seven', 'Eight'], cat: 'general', tier: 1 },
  { q: 'In cooking, what does it mean to \u201cjulienne\u201d something?', a: ['Cut it into thin matchsticks', 'Boil it briefly', 'Coat it in flour', 'Cook it slowly in fat'], cat: 'general', tier: 3 },
  { q: 'Which board game uses the terms check and stalemate?', a: ['Chess', 'Draughts', 'Backgammon', 'Go'], cat: 'general', tier: 1 },
  { q: 'What is the national flower of India?', a: ['The lotus', 'The rose', 'The marigold', 'The jasmine'], cat: 'general', tier: 2 },
  { q: 'How many minutes are there in a full day?', a: ['1,440', '1,240', '1,640', '720'], cat: 'general', tier: 2 },
  { q: 'What do you call a word that reads the same backwards?', a: ['A palindrome', 'An anagram', 'A homonym', 'An acronym'], cat: 'general', tier: 2 },
  { q: 'Which instrument has keys, pedals and strings inside a wooden case?', a: ['The piano', 'The organ', 'The harp', 'The accordion'], cat: 'general', tier: 1 },
  { q: 'What is the currency of Japan?', a: ['The yen', 'The won', 'The yuan', 'The baht'], cat: 'general', tier: 1 },
  { q: 'How many colours are in a standard rainbow as usually listed?', a: ['Seven', 'Six', 'Five', 'Eight'], cat: 'general', tier: 1 },

  /* ───────────────────────── science ───────────────────────── */
  { q: 'Which gas do plants absorb from the air to make their food?', a: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'], cat: 'science', tier: 1,
    note: 'Photosynthesis takes in carbon dioxide and gives back oxygen.' },
  { q: 'How many bones are there in an adult human body?', a: ['206', '186', '226', '245'], cat: 'science', tier: 2,
    note: 'Babies start with around 270 — many fuse together as you grow.' },
  { q: 'What is the chemical symbol for gold?', a: ['Au', 'Go', 'Gd', 'Ag'], cat: 'science', tier: 1,
    note: 'From the Latin *aurum*. Ag is silver, from *argentum*.' },
  { q: 'Which planet has the shortest day in our solar system?', a: ['Jupiter', 'Mercury', 'Mars', 'Venus'], cat: 'science', tier: 2,
    note: 'Jupiter spins once in just under 10 hours despite being the largest planet.' },
  { q: 'What part of the cell is called the powerhouse?', a: ['Mitochondria', 'Nucleus', 'Ribosome', 'Golgi body'], cat: 'science', tier: 1 },
  { q: 'Light travels at roughly what speed in a vacuum?', a: ['300,000 km per second', '300,000 km per hour', '30,000 km per second', '3,000,000 km per second'], cat: 'science', tier: 2 },
  { q: 'Which blood cells are mainly responsible for fighting infection?', a: ['White blood cells', 'Red blood cells', 'Platelets', 'Plasma cells only'], cat: 'science', tier: 1 },
  { q: 'What is the most abundant gas in Earth\u2019s atmosphere?', a: ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Argon'], cat: 'science', tier: 2,
    note: 'Nitrogen is about 78% of the air; oxygen is only about 21%.' },
  { q: 'Who proposed the general theory of relativity?', a: ['Albert Einstein', 'Isaac Newton', 'Niels Bohr', 'Galileo Galilei'], cat: 'science', tier: 1 },
  { q: 'What is the hardest naturally occurring substance?', a: ['Diamond', 'Quartz', 'Steel', 'Titanium'], cat: 'science', tier: 1 },
  { q: 'Water boils at 100°C at sea level. What happens to that boiling point high up a mountain?', a: ['It falls', 'It rises', 'It stays the same', 'It becomes unpredictable'], cat: 'science', tier: 2,
    note: 'Lower air pressure means the water needs less heat to boil — which is why cooking takes longer up there.' },
  { q: 'Which scientist formulated the three laws of motion?', a: ['Isaac Newton', 'Albert Einstein', 'Michael Faraday', 'James Clerk Maxwell'], cat: 'science', tier: 1 },
  { q: 'Which element has the atomic number 1?', a: ['Hydrogen', 'Helium', 'Carbon', 'Lithium'], cat: 'science', tier: 1 },
  { q: 'Roughly how long does sunlight take to reach the Earth?', a: ['About 8 minutes', 'About 8 seconds', 'About 8 hours', 'Instantly'], cat: 'science', tier: 3 },
  { q: 'What is the study of fungi called?', a: ['Mycology', 'Botany', 'Entomology', 'Virology'], cat: 'science', tier: 3 },
  { q: 'Which particle carries a negative electric charge?', a: ['Electron', 'Proton', 'Neutron', 'Positron'], cat: 'science', tier: 1 },
  { q: 'Absolute zero is approximately which temperature in Celsius?', a: ['−273°C', '−100°C', '−451°C', '0°C'], cat: 'science', tier: 3 },
  { q: 'Which of these is NOT a state of matter?', a: ['Energy', 'Solid', 'Liquid', 'Plasma'], cat: 'science', tier: 1 },
  { q: 'What force keeps the planets in orbit around the Sun?', a: ['Gravity', 'Magnetism', 'Friction', 'The strong nuclear force'], cat: 'science', tier: 1 },
  { q: 'How many chambers does a human heart have?', a: ['Four', 'Two', 'Three', 'Six'], cat: 'science', tier: 1 },
  { q: 'Which vitamin does the body make when skin is exposed to sunlight?', a: ['Vitamin D', 'Vitamin C', 'Vitamin A', 'Vitamin B12'], cat: 'science', tier: 2 },
  { q: 'The Great Wall was built mainly to defend which country?', a: ['China', 'Japan', 'Mongolia', 'Korea'], cat: 'history', tier: 1 },
  { q: 'Which ancient civilisation built the city of Machu Picchu?', a: ['The Inca', 'The Maya', 'The Aztec', 'The Olmec'], cat: 'history', tier: 2 },
  { q: 'Who wrote the Indian Constitution\u2019s drafting committee report as its chairman?', a: ['B. R. Ambedkar', 'Jawaharlal Nehru', 'Sardar Patel', 'Rajendra Prasad'], cat: 'history', tier: 2 },
  { q: 'The Titanic sank on its maiden voyage in which year?', a: ['1912', '1905', '1920', '1898'], cat: 'history', tier: 1 },
  { q: 'Which empire was ruled by Julius Caesar\u2019s successors?', a: ['The Roman Empire', 'The Ottoman Empire', 'The Persian Empire', 'The Greek Empire'], cat: 'history', tier: 1 },
  { q: 'The Berlin Wall fell in which year?', a: ['1989', '1991', '1985', '1979'], cat: 'history', tier: 2 },
  { q: 'Who was the first Prime Minister of independent India?', a: ['Jawaharlal Nehru', 'Mahatma Gandhi', 'Indira Gandhi', 'Lal Bahadur Shastri'], cat: 'history', tier: 1 },
  { q: 'Which queen ruled Britain for 63 years in the nineteenth century?', a: ['Victoria', 'Elizabeth I', 'Anne', 'Mary II'], cat: 'history', tier: 2 },
  { q: 'Which war was fought between the North and South of the United States?', a: ['The Civil War', 'The War of Independence', 'The Mexican War', 'The Cold War'], cat: 'history', tier: 1 },
  { q: 'The Mughal emperor who built the Taj Mahal was who?', a: ['Shah Jahan', 'Akbar', 'Aurangzeb', 'Babur'], cat: 'history', tier: 1,
    note: 'He built it as a tomb for his wife Mumtaz Mahal — arguably history\u2019s grandest love letter.' },
  { q: 'Which city was destroyed by the eruption of Mount Vesuvius in AD 79?', a: ['Pompeii', 'Athens', 'Carthage', 'Alexandria'], cat: 'history', tier: 2 },
  { q: 'Who led the Salt March of 1930?', a: ['Mahatma Gandhi', 'Subhas Chandra Bose', 'Bhagat Singh', 'Bal Gangadhar Tilak'], cat: 'history', tier: 1 },
  { q: 'The first successful aeroplane flight is credited to which brothers?', a: ['The Wright brothers', 'The Montgolfier brothers', 'The Lumière brothers', 'The Grimm brothers'], cat: 'history', tier: 1 },
  { q: 'Which ship carried Charles Darwin on his famous voyage?', a: ['HMS Beagle', 'HMS Victory', 'HMS Endeavour', 'HMS Discovery'], cat: 'history', tier: 3 },
  { q: 'In which century did the French Revolution begin?', a: ['The 18th', 'The 17th', 'The 19th', 'The 16th'], cat: 'history', tier: 2 },
  { q: 'Who was the Egyptian queen famously linked with both Caesar and Mark Antony?', a: ['Cleopatra', 'Nefertiti', 'Hatshepsut', 'Isis'], cat: 'history', tier: 1 },
  { q: 'Which explorer\u2019s crew first circumnavigated the globe?', a: ['Ferdinand Magellan', 'Christopher Columbus', 'Vasco da Gama', 'Marco Polo'], cat: 'history', tier: 3,
    note: 'Magellan himself died on the way; his crew finished the trip.' },
  { q: 'The Cold War was mainly between the United States and which other power?', a: ['The Soviet Union', 'China', 'Germany', 'Japan'], cat: 'history', tier: 1 },
  { q: 'Which Indian city was the capital of British India before Delhi?', a: ['Calcutta', 'Bombay', 'Madras', 'Lahore'], cat: 'history', tier: 3 },
  { q: 'Who painted the ceiling of the Sistine Chapel?', a: ['Michelangelo', 'Raphael', 'Leonardo da Vinci', 'Donatello'], cat: 'history', tier: 2 },
  { q: 'Which is the longest river in the world?', a: ['The Nile', 'The Amazon', 'The Yangtze', 'The Mississippi'], cat: 'general', tier: 2 },
  { q: 'In which sport would you perform a slam dunk?', a: ['Basketball', 'Volleyball', 'Tennis', 'Cricket'], cat: 'general', tier: 1 },
  { q: 'Which ocean is the largest?', a: ['The Pacific', 'The Atlantic', 'The Indian', 'The Arctic'], cat: 'general', tier: 1 },
  { q: 'How many players are on the field per cricket team?', a: ['Eleven', 'Nine', 'Ten', 'Twelve'], cat: 'general', tier: 1 },
  { q: 'Which planet is known as the Red Planet?', a: ['Mars', 'Venus', 'Jupiter', 'Mercury'], cat: 'general', tier: 1 },
  { q: 'What is the tallest mountain above sea level?', a: ['Mount Everest', 'K2', 'Kangchenjunga', 'Denali'], cat: 'general', tier: 1 },
  { q: 'Which instrument has 88 keys in its standard form?', a: ['The piano', 'The organ', 'The accordion', 'The harpsichord'], cat: 'general', tier: 2 },
  { q: 'Which country gifted the Statue of Liberty to the United States?', a: ['France', 'Britain', 'Spain', 'Italy'], cat: 'general', tier: 2 },
  { q: 'What do you call a group of lions?', a: ['A pride', 'A pack', 'A herd', 'A flock'], cat: 'general', tier: 1 },
  { q: 'Which is the only continent with no permanent human residents?', a: ['Antarctica', 'Australia', 'South America', 'Africa'], cat: 'general', tier: 2 },
  { q: 'How many colours are there in a standard rainbow?', a: ['Seven', 'Six', 'Five', 'Eight'], cat: 'general', tier: 1 },
  { q: 'Which metal is liquid at room temperature?', a: ['Mercury', 'Lead', 'Tin', 'Aluminium'], cat: 'general', tier: 2 },
  { q: 'What is the national sport of Japan, by tradition?', a: ['Sumo wrestling', 'Baseball', 'Judo', 'Karate'], cat: 'general', tier: 3 },
  { q: 'The Sahara Desert is on which continent?', a: ['Africa', 'Asia', 'Australia', 'South America'], cat: 'general', tier: 1 },
  { q: 'How many degrees are there in a full circle?', a: ['360', '180', '270', '400'], cat: 'general', tier: 1 },
  { q: 'Which fruit is traditionally used to make wine?', a: ['Grapes', 'Apples', 'Plums', 'Cherries'], cat: 'general', tier: 1 },
  { q: 'What is the hardest working muscle in the human body, by total work done?', a: ['The heart', 'The tongue', 'The jaw muscle', 'The calf'], cat: 'general', tier: 3 },
  { q: 'How many squares are there on a chessboard?', a: ['64', '72', '81', '56'], cat: 'general', tier: 1 },

  /* ──────────────────── Filipino general knowledge ──────────────────── */
  { q: 'What is the capital city of the Philippines?', a: ['Manila', 'Quezon City', 'Cebu City', 'Davao City'], cat: 'philippines', tier: 1,
    note: 'Quezon City is the most populous city, but the capital has been Manila since 1976.' },
  { q: 'Which is the largest island in the Philippines?', a: ['Luzon', 'Mindanao', 'Samar', 'Palawan'], cat: 'philippines', tier: 1 },
  { q: 'The Philippine national language, Filipino, is primarily based on which language?', a: ['Tagalog', 'Cebuano', 'Ilocano', 'Hiligaynon'], cat: 'philippines', tier: 2,
    note: 'The 1987 constitution names Filipino as the national language and lets it keep growing from the country\'s other languages.' },
  { q: 'Who is recognised as the national hero of the Philippines?', a: ['Jose Rizal', 'Andres Bonifacio', 'Emilio Aguinaldo', 'Apolinario Mabini'], cat: 'philippines', tier: 1,
    note: 'Rizal\'s novels Noli Me Tangere and El Filibusterismo are still read in Philippine schools.' },
  { q: 'What is the currency of the Philippines?', a: ['The Philippine peso', 'The ringgit', 'The baht', 'The rupiah'], cat: 'philippines', tier: 1 },
  { q: 'Which is the highest mountain in the Philippines?', a: ['Mount Apo', 'Mount Pulag', 'Mount Mayon', 'Mount Banahaw'], cat: 'philippines', tier: 2,
    note: 'Mount Apo rises to about 2,954 m on the island of Mindanao.' },
  { q: 'The near-perfect cone of Mayon volcano is in which province?', a: ['Albay', 'Batangas', 'Camarines Sur', 'Sorsogon'], cat: 'philippines', tier: 2 },
  { q: 'The Chocolate Hills, hundreds of grassy domes, are found on which island?', a: ['Bohol', 'Cebu', 'Leyte', 'Negros'], cat: 'philippines', tier: 1 },
  { q: 'The Banaue Rice Terraces were carved into the mountains of which province?', a: ['Ifugao', 'Benguet', 'Mountain Province', 'Kalinga'], cat: 'philippines', tier: 2 },
  { q: 'The Philippine eagle, the national bird, is also known as what?', a: ['The monkey-eating eagle', 'The sea eagle', 'The crested hawk', 'The jungle falcon'], cat: 'philippines', tier: 3,
    note: 'It is one of the largest and rarest eagles in the world, and is critically endangered.' },
  { q: 'The tiny tarsier, one of the smallest primates, is most associated with which island?', a: ['Bohol', 'Palawan', 'Mindoro', 'Panay'], cat: 'philippines', tier: 2 },
  { q: 'The preserved Spanish colonial town of Vigan is a UNESCO World Heritage Site in which province?', a: ['Ilocos Sur', 'Ilocos Norte', 'La Union', 'Pangasinan'], cat: 'philippines', tier: 3 },
  { q: 'Boracay, the white-sand resort island, belongs to which province?', a: ['Aklan', 'Antique', 'Capiz', 'Iloilo'], cat: 'philippines', tier: 2 },
  { q: 'What do the three stars on the Philippine flag represent?', a: ['Luzon, the Visayas and Mindanao', 'The three branches of government', 'The first three provinces to revolt', 'Past, present and future'], cat: 'philippines', tier: 2,
    note: 'The eight rays of the sun stand for the first eight provinces placed under martial law in 1896.' },
  { q: 'Philippine independence was proclaimed on 12 June 1898 in which town?', a: ['Kawit, Cavite', 'Malolos, Bulacan', 'Biak-na-Bato, Bulacan', 'Imus, Cavite'], cat: 'philippines', tier: 3 },
  { q: 'What is the smallest unit of local government in the Philippines?', a: ['The barangay', 'The municipality', 'The province', 'The district'], cat: 'philippines', tier: 2 },
  { q: 'The longest river in the Philippines is which one?', a: ['The Cagayan River', 'The Pasig River', 'The Agno River', 'The Pampanga River'], cat: 'philippines', tier: 3,
    note: 'The Cagayan River runs about 505 km through northern Luzon.' },
  { q: 'The jeepney, the country\'s best-known form of public transport, began as what?', a: ['Converted surplus military jeeps', 'Imported London buses', 'Rebuilt tram carriages', 'Wooden horse carts'], cat: 'philippines', tier: 2,
    note: 'They were built from jeeps left behind after the Second World War, then decorated and stretched to carry passengers.' },
  { q: 'Which city was the capital of the Philippines from 1948 until 1976?', a: ['Quezon City', 'Cebu City', 'Baguio', 'Makati'], cat: 'philippines', tier: 3 },
  { q: 'Mount Pinatubo, whose 1991 eruption cooled global temperatures for a year, sits on which island?', a: ['Luzon', 'Mindanao', 'Negros', 'Panay'], cat: 'philippines', tier: 3 },

  /* ──────────────────── people & society ──────────────────── */
  { q: 'The international body founded in 1945 to keep peace between countries is called what?', a: ['The United Nations', 'The League of Nations', 'The World Court', 'The Atlantic Council'], cat: 'society', tier: 1 },
  { q: 'In which year was the Universal Declaration of Human Rights adopted?', a: ['1948', '1919', '1966', '1975'], cat: 'society', tier: 2,
    note: 'The UN General Assembly adopted it in Paris on 10 December 1948.' },
  { q: 'The movement of people from the countryside into cities is called what?', a: ['Urbanisation', 'Irrigation', 'Emigration', 'Suburban sprawl'], cat: 'society', tier: 2 },
  { q: 'Which of these is a renewable source of electricity?', a: ['Wind', 'Coal', 'Diesel', 'Natural gas'], cat: 'society', tier: 1 },
  { q: 'What is a census?', a: ['An official count of a population', 'A tax on imported goods', 'A vote held in parliament', 'A survey of company profits'], cat: 'society', tier: 2 },
  { q: 'What does GDP measure?', a: ['The value of goods and services a country produces', 'The number of people in work', 'A country\'s foreign debt', 'Average household savings'], cat: 'society', tier: 3,
    note: 'Gross domestic product counts what is produced inside a country in a given period. It says nothing about how evenly it is shared.' },
  { q: 'What was the Kyoto Protocol mainly about?', a: ['Reducing greenhouse-gas emissions', 'Banning nuclear testing', 'Regulating international shipping', 'Protecting endangered species'], cat: 'society', tier: 3,
    note: 'Agreed in 1997, it set binding emission targets for developed countries.' },
  { q: 'Which organisation publishes the Human Development Index?', a: ['The United Nations Development Programme', 'The World Bank', 'The World Trade Organization', 'The International Monetary Fund'], cat: 'society', tier: 3 },
  { q: 'What is a referendum?', a: ['A direct public vote on a single question', 'A debate in a parliament', 'A petition to change a law', 'An appointment to a court'], cat: 'society', tier: 2 },
  { q: 'What is the main purpose of a constitution?', a: ['To set out how a state is governed and what it may not do', 'To list every law a country has', 'To record the results of elections', 'To set the annual budget'], cat: 'society', tier: 2 },
  { q: 'What does the word suffrage mean?', a: ['The right to vote', 'The right to own land', 'Freedom of movement', 'Protection from unfair trials'], cat: 'society', tier: 1 },
  { q: 'Which of these is a primary source for a historian?', a: ['A diary written at the time', 'A textbook written last year', 'A documentary made in 2010', 'An encyclopaedia entry'], cat: 'society', tier: 2 },
  { q: 'What is inflation?', a: ['A general rise in prices over time', 'A fall in the value of housing', 'An increase in wages only', 'A rise in the value of a currency'], cat: 'society', tier: 2 },
  { q: 'What is the World Health Organization best known for doing?', a: ['Coordinating international public health', 'Setting global interest rates', 'Settling trade disputes', 'Running peacekeeping troops'], cat: 'society', tier: 2 },
  { q: 'What makes an organisation an NGO?', a: ['It is independent of any government', 'It is funded only by donations', 'It must be run by volunteers', 'It operates in more than one country'], cat: 'society', tier: 3 },
  { q: 'Which language has the most native speakers in the world?', a: ['Mandarin Chinese', 'English', 'Spanish', 'Hindi'], cat: 'society', tier: 2,
    note: 'English has more total speakers once second-language speakers are counted.' },
  { q: 'What is a trade union?', a: ['A group of workers who bargain collectively', 'A company that imports goods', 'A government department for industry', 'An association of employers'], cat: 'society', tier: 2 },
  { q: 'In most countries, including the Philippines, at what age may people first vote?', a: ['18', '16', '21', '25'], cat: 'society', tier: 1 },
];

/** Sanity: the bank must never ship a question with duplicate options. */
export function bankIsSound(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const q of BANK) {
    if (new Set(q.a).size !== 4) problems.push(`duplicate option: ${q.q}`);
    if (q.a.some((o) => !o.trim())) problems.push(`blank option: ${q.q}`);
    if (seen.has(q.q)) problems.push(`duplicate question: ${q.q}`);
    seen.add(q.q);
  }
  return { ok: problems.length === 0, problems };
}
