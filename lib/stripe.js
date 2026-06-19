const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_KEY);

const createCheckoutSession = async (customerEmail, priceId, successUrl, cancelUrl) => {
  return await stripe.checkout.sessions.create({
    customer_email: customerEmail,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
};

const createCustomerPortalSession = async (customerId, returnUrl) => {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
};

module.exports = {
  stripe,
  createCheckoutSession,
  createCustomerPortalSession,
};
