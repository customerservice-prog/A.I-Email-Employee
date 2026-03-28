require('dotenv').config();

const { classifyInboundEmail } = require('./services/classifier');

const simple = {
  from: 'jamie@example.com',
  subject: 'Chair rental for Saturday',
  body: 'Hi — do you have 40 white folding chairs available this Saturday morning for pickup? Thanks, Jamie',
};

const complex = {
  from: 'events@downtownvenue.org',
  subject: 'Tent + tables quote — corporate field day + rain plan',
  body: `Hello,

We're hosting a 120-person outdoor lunch on May 18 at Riverside Park. We need:
- A tent that can seat 120 at rounds (or your recommendation)
- Delivery by 9am, strike after 6pm
- Backup plan if forecast shows storms (can we add sidewalls day-of?)

Also need ADA-compliant seating for 6 guests and a separate small tent (10x10) for registration.

Please send a line-item quote including delivery, setup, and teardown. Our finance team needs PO #DTW-8841 on the invoice.

Thanks,
Alex Morgan
Events Manager, Downtown Venue Collective
`,
};

const discount = {
  from: 'buyer@corp.com',
  subject: 'Best price?',
  body: 'What discount can you give us if we double the order? We need your lowest price.',
};

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      'Set OPENAI_API_KEY in .env (or the environment) before running this script.'
    );
    process.exit(1);
  }

  console.log('--- Simple (expect review track unless KB is very strong) ---');
  console.log(JSON.stringify(await classifyInboundEmail(simple, 'default'), null, 2));

  console.log('\n--- Complex quote ---');
  console.log(JSON.stringify(await classifyInboundEmail(complex, 'default'), null, 2));

  console.log('\n--- Discount (hard block, no GPT) ---');
  console.log(JSON.stringify(await classifyInboundEmail(discount, 'default'), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
