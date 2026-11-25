# Salon Queue Management System — Screen Requirements

## 1. Home Screen (`/`)

**Purpose:** Give customers an overview of the salon and allow them to join the queue.

**Elements:**
- Salon logo and name.
- Current salon open/closed status.
- Number of customers waiting.
- Estimated waiting time.
- Available barber names and availability.
- Join Queue button.
- English/Gujarati language toggle.

**Button Behaviour:**
- Join Queue opens the Join Queue screen.
- Language toggle changes the interface language.

**Device Layout:** Mobile-first, responsive on tablets and desktops.

**Empty/Error States:**
- If nobody is waiting, show "No customers waiting".
- If the salon is closed, show that online queue joining is unavailable.

## 2. Join Queue Screen (`/join`)

**Purpose:** Allow customers to enter their details and join the queue.

**Elements:**
- Customer name field.
- 10-digit mobile number field.
- Service selection (maximum 3 services).
- Display service duration and price.
- Barber selection or Any Barber option.
- Booking summary.
- Confirm button.

**Button Behaviour:**
- Confirm validates the details and adds the customer to the queue.
- Show the generated token after successful joining.

**Device Layout:** Mobile-friendly form.

**Empty/Error States:**
- Show validation messages for missing or invalid details.
- Prevent duplicate active queue entries for the same phone number.
- Show an error if the selected barber is unavailable.

## 3. My Status Screen (`/status/:id`)

**Purpose:** Let customers track their queue status.

**Elements:**
- Token number.
- Current queue position.
- Estimated waiting time.
- Queue status.
- Cancel Spot button.
- Start Coming message when the customer is second in line.
- It's Your Turn message when the receptionist calls them.

**Button Behaviour:**
- Cancel Spot removes the customer from the waiting queue after confirmation.

**Device Layout:** Mobile-first.

**Empty/Error States:**
- Show a helpful message if the token cannot be found.
- Show the final status if the customer is cancelled, completed or marked no-show.

## 4. Reception Dashboard (`/reception`)

**Purpose:** Help receptionists manage the complete salon queue.

**Elements:**
- Cards for each barber.
- Current customer assigned to each barber.
- Service progress and remaining time.
- Call Next button for each available barber.
- Ordered waiting customer list.
- Add Walk-in button.
- No-show and Cancel actions.
- Highlight customers waiting more than 60 minutes.

**Button Behaviour:**
- Call Next assigns the earliest eligible customer to that barber.
- Add Walk-in adds a new customer to the end of the queue.
- No-show updates the customer's status.
- Cancel removes an eligible customer from the queue.

**Device Layout:** Tablet-friendly dashboard.

**Empty/Error States:**
- Show "No customers waiting" when the queue is empty.
- Disable Call Next if no eligible customer exists.

## 5. Barber View (`/barber/:name`)

**Purpose:** Let barbers manage their assigned customers.

**Elements:**
- Barber name.
- Current customer and token.
- Selected services.
- Service timer.
- Start and Done buttons.
- Next customer information.
- On Break and Available controls.

**Button Behaviour:**
- Start changes the customer status to In Chair and starts the service timer.
- Done marks the service as completed.
- On Break changes barber availability.
- Available makes the barber available again.

**Device Layout:** Mobile-friendly.

**Empty/Error States:**
- Show "No customer assigned" when there is no active customer.
- Prevent starting another customer while one is already being served.

## 6. Waiting Area TV Display (`/display`)

**Purpose:** Display live queue information in the salon waiting area.

**Elements:**
- Salon name and branding.
- Barber names.
- Current token being served by each barber.
- Next five waiting tokens.
- Visual highlight for newly called tokens.
- Optional notification chime when a customer is called.

**Button Behaviour:**
- No manual buttons are required.
- Information updates automatically when the queue changes.

**Device Layout:** Large-screen TV layout with clear, readable text.

**Empty/Error States:**
- Show a welcoming message when no customers are waiting.
- Show a connection warning if live updates stop working.

## 7. Owner Settings (`/admin`)

**Purpose:** Allow the salon owner to manage salon operations.

**Elements:**
- List of salon services.
- Service name in English and Gujarati.
- Service duration and price.
- Enable/disable service controls.
- Barber duty and availability settings.
- Online queue Open/Closed control.
- Basic queue statistics.

**Button Behaviour:**
- Save updates service details.
- Enable/disable controls determine which services customers can select.
- Barber controls update who is available for assignment.
- Online queue control allows or stops new online entries.

**Device Layout:** Desktop and tablet-friendly.

**Empty/Error States:**
- Show a helpful message if no services or barbers are configured.
- Validate service duration and price before saving.

## General Interface Requirements

- Every screen must support English and Gujarati.
- Use a consistent charcoal and gold visual theme.
- Use readable typography and rounded cards.
- Buttons must have clear labels and visible feedback.
- Layouts must adapt to mobile, tablet and desktop screens.
- Provide loading, empty and error states wherever required.