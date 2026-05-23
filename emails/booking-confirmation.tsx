import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export interface BookingConfirmationEmailProps {
  experienceTitle: string
  vendorName: string
  participantCount: number
  grossTotalRupees: number
  cancellationPreset: string
  bookingId: string
}

export function BookingConfirmationEmail({
  experienceTitle,
  vendorName,
  participantCount,
  grossTotalRupees,
  cancellationPreset,
  bookingId,
}: BookingConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Booking confirmed: {experienceTitle}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Booking Confirmed</Heading>
          <Text style={textStyle}>
            Your booking for <strong>{experienceTitle}</strong> by{' '}
            {vendorName} is confirmed.
          </Text>

          <Hr style={hrStyle} />

          <Section>
            <Text style={labelStyle}>Booking ID</Text>
            <Text style={valueStyle}>{bookingId}</Text>

            <Text style={labelStyle}>Participants</Text>
            <Text style={valueStyle}>{participantCount}</Text>

            <Text style={labelStyle}>Total</Text>
            <Text style={valueStyle}>₹{grossTotalRupees}</Text>

            <Text style={labelStyle}>Cancellation Policy</Text>
            <Text style={valueStyle}>
              {cancellationPreset.charAt(0).toUpperCase() + cancellationPreset.slice(1)}
            </Text>
          </Section>

          <Hr style={hrStyle} />

          <Text style={footerStyle}>
            If you have questions about this booking, reply to this email or
            reach out to our support team.
          </Text>
          <Text style={footerStyle}>— Outvers</Text>
        </Container>
      </Body>
    </Html>
  )
}

export function bookingConfirmationSubject(experienceTitle: string): string {
  return `Booking confirmed: ${experienceTitle}`
}

const bodyStyle = {
  backgroundColor: '#f4f4f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const containerStyle = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 24px',
  maxWidth: '560px',
  borderRadius: '8px',
}

const headingStyle = {
  fontSize: '24px',
  fontWeight: '700' as const,
  color: '#18181b',
  marginBottom: '16px',
}

const textStyle = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#3f3f46',
}

const labelStyle = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: '#71717a',
  textTransform: 'uppercase' as const,
  marginBottom: '2px',
}

const valueStyle = {
  fontSize: '16px',
  color: '#18181b',
  marginTop: '0',
  marginBottom: '12px',
}

const hrStyle = {
  borderColor: '#e4e4e7',
  margin: '20px 0',
}

const footerStyle = {
  fontSize: '14px',
  color: '#a1a1aa',
}

export default BookingConfirmationEmail
