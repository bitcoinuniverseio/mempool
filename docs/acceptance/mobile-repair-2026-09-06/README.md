# Mobile source repair evidence

The historical Chromium mobile job from run 34032083836 failed at source 445702835144f1998dc3ed1f79e2ef77ed6871af. Its three original reports retain all 792 route/viewport records and 226 findings: 197 undeclared horizontal scrollers, 22 clipped-content findings, six small checkbox-group findings and one documentation scroll-timing finding.

Source revision 36ca74f9d7eb94101dd526bc7b85bec6ae0ed75b addresses those findings in 76 files. The annotation checker changes from 71 failing component files to none, covering 82 distinct containers and the 197 observed scroller occurrences. This is source/template evidence. The complete frontend unit run passed 97 files and 1,543 tests; the production build completed at 13:31:56.512 UTC with Angular hash e6ec4e6f8ae5c658. Build warnings remain in the archived log.

The first headless browser attempt failed before measuring a page. A later four-page launcher smoke reported no mobile failures, but its gate changes had not passed independent strength review; that preliminary result is not accepted. The stronger 22-route audit and final served-build binding are still required. No mobile or real-network operation pass is added by this record.

Backend follow-up b9ddc216c1fd4dd0a478f2fc44f929d4195dbe9b prevents a fresh index checkpoint from replacing an unavailable explicitly separate node reference. Its 107 focused tests and exact-source CI passed; CI included 4,574 unit and 27 integration-framework tests. PR 179 merged as 7bf6ffc16d48f4f0c11e122d02385138f9b5de2e. The older CRLF lint failure is preserved, and final scoped and CI lint results passed. These results do not relabel the previously observed overlay 8b2aea3afd4b2f26e2ee5f1275171a937515cbc2.

The manifest at ../mobile-source-repair-2026-09-06.json records source hashes, exact archive hashes, timestamps and each evidence limitation. Historical runtime evidence remains bound to frontend/gateway 64d9ebccd6deb1da07c14fbb3fe77596af1f3646 and overlay 8b2aea3afd4b2f26e2ee5f1275171a937515cbc2. The functional gate remains NO-GO.
