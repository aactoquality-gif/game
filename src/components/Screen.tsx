interface ScreenProps {
  screen: {
    text: string
    image?: string
    choices: Array<{
      text: string
      nextScreen: string
    }>
  }
  onChoice: (nextScreen: string) => void
}

export default function Screen({ screen, onChoice }: ScreenProps) {
  return (
    <div style={{ textAlign: 'center' }}>
      {screen.image && (
        <img 
          src={screen.image} 
          alt="screen" 
          style={{ maxWidth: '100%', marginBottom: '20px' }}
        />
      )}
      
      <p style={{ fontSize: '18px', marginBottom: '30px', lineHeight: '1.6' }}>
        {screen.text}
      </p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {screen.choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => onChoice(choice.nextScreen)}
            style={{
              padding: '12px 20px',
              fontSize: '16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            {choice.text}
          </button>
        ))}
      </div>
    </div>
  )
}