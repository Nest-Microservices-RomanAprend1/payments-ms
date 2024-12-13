import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';


@Injectable()
export class PaymentsService {
    private readonly stripe = new Stripe(envs.stripeSecret, {})
    private readonly logger = new Logger('PaymentsService');

    constructor(
        @Inject(NATS_SERVICE) private readonly client: ClientProxy
    ){}

    async createPaymentSession(paymentSessionDto: PaymentSessionDto) {

        const { currency, items, orderId } = paymentSessionDto;

        const lineItems = items.map(item => {
            return {
                price_data: {
                    currency,
                    product_data: {
                        name: item.name,
                    },
                    unit_amount: Math.round(item.price * 100),
                },
                quantity: item.quantity,
            }
        });

        const session = await this.stripe.checkout.sessions.create({
            //colocar el ID de mi orden
            payment_intent_data: {
                metadata: {
                    orderId: orderId,
                },
            },
            line_items: lineItems,
            mode: 'payment',
            success_url: envs.stripeSuccessUrl,
            cancel_url: envs.stripeCancelUrl,

        });

        // return session
        return {
            cancelUrl: session.cancel_url,
            successUrl: session.success_url,
            url: session.url,
        }
    }

    async stripeWebhook(req: Request, res: Response) {
        const sig = req.headers['stripe-signature'];
        let event: Stripe.Event;
        // Testing
        // const endpointSecret = 'whsec_749248735734713840061b2d4b36d84912cf823d7771d2465c859e89df566c01'
        //REal
        const endpointSecret = envs.stripeEndpointSecret;

        try {
            event = this.stripe.webhooks.constructEvent(
                req['rawBody'],
                sig,
                endpointSecret
            );

        } catch (err) {
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        // console.log({ event });

        switch (event.type) {
            case 'charge.succeeded':
                //TODO: llamar a nuetro microservicio
                const charceSucceded = event.data.object;
                const payload = {
                    stripePaymentId: charceSucceded.id,
                    orderId: charceSucceded.metadata.orderId,
                    receiptUrl: charceSucceded.receipt_url,
                }
                // this.logger.log({ payload })
                this.client.emit('payment.succeeded', payload);
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }


        return res.status(200).json(sig);
    }
}
