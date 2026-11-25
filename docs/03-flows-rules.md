# Salon Queue Management System — Flows and Rules

## 1. Customer Online Queue Flow

1. Customer opens the Home screen.
2. Customer checks salon status, waiting customers and estimated waiting time.
3. Customer clicks Join Queue.
4. Customer enters their name and 10-digit phone number.
5. Customer selects up to three services.
6. The system displays the selected services, total duration and price.
7. Customer selects a preferred barber or Any Barber.
8. Customer confirms the details.
9. The system generates a unique token and adds the customer to the queue.
10. Customer is redirected to My Status to track their position and estimated waiting time.

## 2. Walk-in Customer Flow

1. Receptionist opens the Reception Dashboard.
2. Receptionist clicks Add Walk-in.
3. Receptionist enters the customer's details and selected services.
4. Receptionist selects a preferred barber or Any Barber.
5. The system generates a token.
6. The customer is added to the end of the waiting queue.

Online and walk-in customers must use the same queue.

## 3. Receptionist Flow

1. Receptionist views all barbers and waiting customers.
2. Receptionist selects Call Next for an available barber.
3. The system finds the earliest eligible customer.
4. The customer status changes from Waiting to Called.
5. The customer's token is highlighted on the TV display.
6. If the customer does not arrive within 10 minutes, the receptionist can mark them as No-show.
7. Receptionist can also add walk-in customers or cancel eligible queue entries.

## 4. Barber Flow

1. Barber opens their Barber View.
2. Barber sees their currently assigned customer.
3. Barber clicks Start when the service begins.
4. Customer status changes to In Chair.
5. The service timer starts.
6. Barber clicks Done when the service is complete.
7. Customer status changes to Done.
8. The barber becomes available for the next customer.

## 5. Queue Status Rules

Allowed status transitions:

- Waiting → Called
- Called → In Chair
- In Chair → Done
- Waiting → Cancelled
- Called → No-show

Do not allow customers to move backwards to an earlier status.

## 6. Customer Assignment Rules

1. Customers are served on a first-come, first-served basis among eligible customers.
2. When Call Next is selected for a barber, choose the earliest waiting customer who selected that barber or Any Barber.
3. A customer who selected a specific barber must never be assigned to a different barber.
4. Each barber can have only one active customer at a time.
5. A barber marked On Break cannot receive new customers.
6. Customers who selected a barber on break should see a clear unavailability message and must not be silently reassigned.

## 7. Waiting Time Rules

1. Estimate waiting time using the total service duration of eligible customers ahead in the queue divided by the number of working barbers.
2. Display the result in minutes.
3. Update the estimate whenever the queue or barber availability changes.
4. The estimate is approximate and should be labelled accordingly.

## 8. Cancellation and No-show Rules

1. A customer can cancel their own entry while their status is Waiting.
2. A customer who has already been called cannot cancel through the normal waiting cancellation action.
3. A receptionist can mark a Called customer as No-show after 10 minutes.
4. A customer marked No-show who wants another turn must be added at the end of the queue with a new token.
5. Completed and cancelled entries must not be assigned again.

## 9. Queue Opening and Closing Rules

1. The owner can open or close online queue joining.
2. Online joining automatically closes 30 minutes before the salon's configured closing time.
3. Walk-in customers can still be added by the receptionist while the salon is operating.
4. Existing customers in the queue must continue to be served after online joining closes.

## 10. Test Checklist

- [ ] Customer can join with valid details.
- [ ] Invalid phone numbers are rejected.
- [ ] Duplicate active phone numbers are prevented.
- [ ] Customer can select up to three services.
- [ ] Service duration and price are calculated correctly.
- [ ] Preferred barber assignment is respected.
- [ ] Any Barber customers can be assigned to an eligible available barber.
- [ ] Walk-in customers join the same queue.
- [ ] Call Next selects the earliest eligible customer.
- [ ] Customer status updates correctly after being called.
- [ ] Barber Start and Done actions update the queue.
- [ ] No-show customers can be added again only with a new token at the end.
- [ ] Online queue closes 30 minutes before closing time.
- [ ] Walk-ins remain possible after online joining closes.
- [ ] Gujarati language toggle works.
- [ ] Waiting time updates when the queue changes.
- [ ] Reception, barber and TV screens stay synchronized within 5 seconds.