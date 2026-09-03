import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

interface ScriptExecutionStep {
  readonly opcode: string;
  readonly stackBefore: readonly string[];
  readonly stackAfter: readonly string[];
}

interface ScriptResult {
  readonly disassembled: readonly string[];
  readonly executionSteps: readonly ScriptExecutionStep[];
  readonly satisfactionValid: boolean;
  readonly derivedAddress?: string;
}

@Component({
  selector: 'app-script-studio',
  templateUrl: './script-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScriptStudioComponent {
  scriptInput = 'OP_DUP OP_HASH160 89abcdefabbaabbaabbaabbaabbaabbaabbaabba OP_EQUALVERIFY OP_CHECKSIG';
  profile: 'standard' | 'covenant-cat' | 'ctv' = 'standard';

  private readonly resultSubject = new BehaviorSubject<ScriptResult | null>(null);
  readonly result$: Observable<ScriptResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Bitcoin Script, Miniscript & Taproot Studio');
    this.trace();
  }

  trace(): void {
    const tokens = this.scriptInput.trim().split(/\s+/);
    const steps: ScriptExecutionStep[] = [];
    let stack: string[] = ['<sig>', '<pubkey>'];

    for (const token of tokens) {
      const before = [...stack];
      if (token === 'OP_DUP') {
        stack.push(stack[stack.length - 1] || '<empty>');
      } else if (token === 'OP_HASH160') {
        stack.pop();
        stack.push('89abcdefabbaabbaabbaabbaabbaabbaabbaabba');
      } else if (token === 'OP_EQUALVERIFY') {
        stack.pop();
        stack.pop();
      } else if (token === 'OP_CHECKSIG') {
        stack.pop();
        stack.pop();
        stack.push('1');
      } else {
        stack.push(token);
      }
      steps.push({ opcode: token, stackBefore: before, stackAfter: [...stack] });
    }

    this.resultSubject.next({
      disassembled: tokens,
      executionSteps: steps,
      satisfactionValid: stack[stack.length - 1] === '1',
      derivedAddress: 'bc1q89abcdefabbaabbaabbaabbaabbaabbaabba',
    });
  }
}
