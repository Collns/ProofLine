import { useNavigate } from 'react-router-dom';
import { WizardLayout } from '../components/WizardLayout';
import { useWizard, clearWizardStorage } from '../state/wizard-store';
import { StepIntro } from './steps/StepIntro';
import { StepCompanyInfo } from './steps/StepCompanyInfo';
import { StepDNS } from './steps/StepDNS';
import { StepEmail } from './steps/StepEmail';
import { StepKYB } from './steps/StepKYB';
import { StepKYC } from './steps/StepKYC';
import { StepKeyCeremony } from './steps/StepKeyCeremony';
import { StepAnchored } from './steps/StepAnchored';
import { StepInstallExtension } from './steps/StepInstallExtension';

export function OnboardingWizard() {
  const { state, dispatch } = useWizard();
  const navigate = useNavigate();

  return (
    <WizardLayout step={state.step}>
      {state.step === 'intro' && (
        <StepIntro
          onContinue={() => dispatch({ type: 'ADVANCE_STEP' })}
        />
      )}

      {state.step === 'company-info' && (
        <StepCompanyInfo
          state={state}
          onSetCompanyInfo={(info) =>
            dispatch({ type: 'SET_COMPANY_INFO', payload: info })
          }
          onStartResult={(result) =>
            dispatch({ type: 'SET_START_RESULT', payload: result })
          }
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
        />
      )}

      {state.step === 'dns-verify' && (
        <StepDNS
          state={state}
          onMarkVerified={(at) =>
            dispatch({ type: 'MARK_DNS_VERIFIED', payload: { at } })
          }
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
          onSkip={() => {
            // Demo skip: mark verified now (no real DNS lookup) and advance.
            dispatch({ type: 'MARK_DNS_VERIFIED', payload: { at: Date.now() } });
            dispatch({ type: 'ADVANCE_STEP' });
          }}
        />
      )}

      {state.step === 'email-verify' && (
        <StepEmail
          state={state}
          onMarkVerified={(at) =>
            dispatch({ type: 'MARK_EMAIL_VERIFIED', payload: { at } })
          }
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
          onSkip={() => {
            // Demo skip: mark verified now (no real code sent) and advance.
            dispatch({ type: 'MARK_EMAIL_VERIFIED', payload: { at: Date.now() } });
            dispatch({ type: 'ADVANCE_STEP' });
          }}
        />
      )}

      {state.step === 'kyb' && (
        <StepKYB
          state={state}
          onSetResult={(payload) => dispatch({ type: 'SET_KYB_RESULT', payload })}
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
          onSkip={() => {
            // Demo skip: no Middesk call. Set a passing status with a
            // sentinel vendorRef so downstream steps / finalize see KYB as
            // satisfied and know it was demo-skipped.
            dispatch({
              type: 'SET_KYB_RESULT',
              payload: { vendorRef: 'demo-skipped', status: 'approved', officers: [] },
            });
            dispatch({ type: 'ADVANCE_STEP' });
          }}
        />
      )}

      {state.step === 'kyc' && (
        <StepKYC
          state={state}
          onSetResult={(payload) => dispatch({ type: 'SET_KYC_RESULT', payload })}
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
          onSkip={() => {
            // Demo skip: no Stripe Identity session. Set a passing status
            // with a sentinel vendorRef so finalize sees KYC as satisfied.
            dispatch({
              type: 'SET_KYC_RESULT',
              payload: {
                vendorRef: 'demo-skipped',
                status: 'verified',
                officerEmail: state.officerEmail || state.ownerEmail || '',
              },
            });
            dispatch({ type: 'ADVANCE_STEP' });
          }}
        />
      )}

      {state.step === 'key-ceremony' && (
        <StepKeyCeremony
          state={state}
          onSetCredential={(credentialId) =>
            dispatch({ type: 'SET_DEVICE_CREDENTIAL', payload: { credentialId } })
          }
          onSetAnchor={(anchor) =>
            dispatch({ type: 'SET_ANCHOR', payload: anchor })
          }
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
          onBack={() => dispatch({ type: 'GO_BACK_STEP' })}
        />
      )}

      {state.step === 'anchored' && (
        <StepAnchored
          state={state}
          onAdvance={() => dispatch({ type: 'ADVANCE_STEP' })}
        />
      )}

      {state.step === 'extension' && (
        <StepInstallExtension
          onSkip={() => {
            clearWizardStorage();
            dispatch({ type: 'RESET' });
            navigate('/dashboard');
          }}
        />
      )}
    </WizardLayout>
  );
}
